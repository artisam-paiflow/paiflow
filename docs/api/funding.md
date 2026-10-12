# Deployment funding

Issue #916 adds deployment-token funding discovery and wallet preparation, submission and
reconciliation for deployed STREAMER Schedule and WEBHOOK pool nodes. Hosted testnet verification
remains pending; these endpoints have local automated coverage. No contract ABI change is needed.

All four calls require `Authorization: Bearer pfk_…` bound to the deployment, a confirmed deployment
on the environment network and active service. A token authorizes API access. Any consenting funder
may sign, including wallets other than the owner or Schedule controller. Funders need funded accounts
and the required asset/trustline. Customer keys remain with the wallet; the API never accepts secrets.

GET `/api/v1/deployments/{id}/funding` returns `{data:{deploymentId,network,nodes}}`. Each node has
`nodeId`, `templateKind`, `contractAddress`, `action` (`schedule.fund` or `webhook.fund`), live
`tokenContractAddress`, `authorization:"funding_wallet"` and `effect`. STREAMER asset comes from
on-chain instance storage; Webhook uses its getter. Unreadable/malformed state fails rather than
returning a guessed asset. No callback secret or controller address is returned. Several candidates
may exist; select one explicitly. Discovery admits up to sixteen candidates with at most four live reads
in flight; larger pipelines require reducing the supported candidate set. Snapshot candidates and capability metadata do not establish live
eligibility or wallet funds.

POST the same path with the following strict JSON body:

```json
{
  "nodeId": "schedule",
  "fromAddress": "G…",
  "tokenContractAddress": "C…",
  "amountStroops": "10000000"
}
```

Use the live asset from discovery. `nodeId` may be omitted only for one supported candidate.
`amountStroops` is a positive integer string at most i128::MAX, never a float. The response is
`{data:{intent,txHash,expiresAt,xdr,action,nodeId,fromAddress,tokenContractAddress,amountStroops,network,networkPassphrase}}`.
The XDR is simulated and has finite 180-second validity, with the funder as source.
The exact transaction binds contract, funder, amount, authorization, action and server network.
Sign this envelope unchanged using the funding wallet and returned network passphrase.

POST `/api/v1/deployments/{id}/funding/submit` with `{action,intent,signedXdr}`. No amount, asset,
contract override, generic function name or fee-bump envelope is accepted. Submission verifies the
original intent and wallet signature, durably records its hash before RPC and sends at most once.
Retries use the same intent and signed envelope. The response uses existing transaction status:
`{data:{txHash,network,status,ledger?,error?}}`. Poll `GET /api/v1/deployments/{id}/transactions/{txHash}`.
A repeat submission after the first claim queries status without requiring a new preparation or
rechecking permissions that may have changed. Wrong signatures, networks or altered envelopes fail.

POST `/api/v1/deployments/{id}/funding/reconcile` with `{action,intent}` to adopt externally-broadcast
finality or reconcile abandoned/crashed preparations. Its response is
`{data:{intent,action,txHash,network,state,expiresAt}}`, with `state` PREPARED, SUBMITTING, SUCCESS,
FAILED or EXPIRED. Only durable SUCCESS/FAILED or ledger-proven EXPIRED permits another preparation.
UNKNOWN, a queue refusal, wall-clock timeout, missing events, 404 or expired RPC history alone never
permits a replacement deposit. Insufficient history retains the reservation. One unresolved intent
per node serializes all funding and controls, including multiple wallets; a conflict exposes the
existing intent/hash in error.fields for recovery. See [wallet-controls.md](wallet-controls.md).

Discovery/preparation: 10 calls/minute/token/route. Submission/reconciliation: 30 calls/minute/token/route.
Responses are no-store; streamed JSON bodies are capped at 110,000 bytes, signed XDR at 100,000 chars.
JSON fields are strict. Invalid/revoked/other-deployment tokens are refused consistently; deployment
retirement closes these endpoints without erasing financial history.

Funding invokes only `STREAMER.top_up(from,amount)` or `WEBHOOK.deposit(from,amount)`. It adds to
contract funds; it does not execute a Schedule payout, Webhook reward or callback. Use `/balances`
for freshness-aware funding visibility, and chain receipts to prove finality. Subsequent Webhook
callbacks use `/api/webhooks/{id}` with `x-webhook-secret`, obtained separately by the owner; the
funding token never substitutes for or exposes that credential.

Existing public `/api/deployments/{id}/trigger` and `/submit-trigger` and hosted `/trigger/{id}` remain
available; their existing signing and transaction-status protocol is unchanged. Deposit-trigger
execute is separate and may pay immediately. Multisig and unsupported templates are excluded.

## Complete application flow

```js
async function call(path, body) {
  const response = await fetch(`${baseUrl}/api/v1/deployments/${deploymentId}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw result.error;
  return result.data;
}
const discovery = await call("/funding");
const node = discovery.nodes.find((node) => node.nodeId === chosenNodeId);
if (!node) throw new Error("Choose a supported funding node");
const prepared = await call("/funding", {
  nodeId: node.nodeId,
  fromAddress: fundingWalletAddress,
  tokenContractAddress: node.tokenContractAddress,
  amountStroops: "10000000",
});
// Persist intent/action/txHash before opening the wallet; preserve this receipt on all failures.
await saveFundingReceipt({
  intent: prepared.intent,
  action: prepared.action,
  txHash: prepared.txHash,
});
const signedXdr = await signWithWallet(prepared.xdr, prepared.networkPassphrase);
await call("/funding/submit", { action: prepared.action, intent: prepared.intent, signedXdr });
const status = await call(`/transactions/${prepared.txHash}`);
// Poll the same hash until SUCCESS or FAILED; UNKNOWN does not authorize another funding attempt.
const recovery = await call("/funding/reconcile", {
  action: prepared.action,
  intent: prepared.intent,
});
const mayPrepareAgain = ["SUCCESS", "FAILED", "EXPIRED"].includes(recovery.state);
```

`signWithWallet`, `saveFundingReceipt`, base URL, selected deployment/node and bearer token are supplied
by your application. Do not request a secret key from the participant. If the wallet is cancelled or
an HTTP call fails, retain the preparation and reconcile it; do not silently create a new one.
