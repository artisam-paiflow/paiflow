# Schedule state and wallet controls

The deployment-token API reads a deployed Schedule and prepares controller-wallet
pause, resume and permitted retrieval without a Paiflow login. These routes are
implemented for standard `STREAMER` contracts. Hosted testnet consent/finality and
retrieval recipient/amount verification remain pending before participant availability
is claimed. Existing signed-in controls and public Schedule funding remain available.
Funding is a separate workflow: a controller control does not top up or pay recipients.

All calls use `Authorization: Bearer pfk_…` for the selected deployment and require
active deployment service. The token grants API access, not controller wallet consent.
Private keys stay in the wallet. The environment selects the network; verify the
returned network against the wallet before signing. See the canonical network model
in [CLAUDE.md §7.5](../../CLAUDE.md#75-networks).

## State and eligibility

`GET /api/v1/deployments/{id}/schedule/state?nodeId=schedule` resolves the contract
from `pipelineSnapshot`. Omit `nodeId` only when there is exactly one STREAMER.
The response identifies `controller`, `tokenContractAddress`, `paused`, `pauseAllowed`,
`retrieveAllowed`, `retrievalRecipient`, and these integer stroop strings:

| Field                | Meaning                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `balanceStroops`     | Current token holdings at the Schedule contract.                                                                 |
| `availableStroops`   | Vested, unpaid payout entitlement according to `available()`. It can exceed holdings in an underfunded Schedule. |
| `claimedStroops`     | Cumulative entitlement already claimed by the contract.                                                          |
| `unvestedStroops`    | `max(balanceStroops - availableStroops, 0)`, the contract's retrieval calculation.                               |
| `retrievableStroops` | That difference while paused and retrieval-permitted, otherwise `"0"`.                                           |

These uncached reads span RPC calls and are indicative, not an atomic ledger snapshot.
`controlEligibility` reports account-wallet protocol support and current pause/resume/retrieve eligibility; it grants no wallet consent. `readAt` records completion. RPC failures return an error, never fresh zero amounts.
Preparing a control simulates the actual contract operation; execution decides final
state and retrieval amount. Insufficient payout funding is not zero vested entitlement.

Pause requires `pauseAllowed:true` and an unpaused Schedule. Resume requires
`pauseAllowed:true` and a paused Schedule. Retrieve requires `paused:true`,
`retrieveAllowed:true` and positive retrievable funds. The controller must be an
account G-address to use this single-wallet envelope protocol. Contract-address
controllers can be read, but address-credential signing is unsupported.

Retrieval always returns funds to the deployed controller. It leaves vested unpaid
entitlement at the contract; callers cannot choose another recipient or amount.
It does not cancel, rewrite the schedule, or pay its recipients.

## Prepare, sign, submit

This browser example assumes an available compatible Freighter wallet, a token passed
in from the app's backend, and the configured deployment. The SDK and wallet keys
remain in the browser. Use `action = "pause"`, `"resume"` or `"retrieve"` as appropriate.

```ts
import { signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

const base = `${baseUrl}/api/v1/deployments/${deploymentId}`;
async function api(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await res.json();
  if (!res.ok) throw result.error; // retain error.fields.intent/txHash on 409
  return result.data;
}

const state = await api(`/schedule/state?nodeId=${encodeURIComponent(nodeId)}`);
// Confirm the connected account is state.controller, show the network and intended action.
const prepared = await api(`/schedule/${action}`, {
  nodeId,
  walletAddress: state.controller,
});
// Store each action's intent and hash separately before opening wallet consent.
// Retrieval: show prepared.recipient and estimatedAmountStroops as an estimate.
const passphrase = prepared.network === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
const signed = await signTransaction(prepared.unsignedXdr, {
  networkPassphrase: passphrase,
  address: prepared.walletAddress,
});
if (signed.error || !signed.signedTxXdr) throw new Error("Wallet did not sign");
const submitted = await api(`/schedule/${action}/submit`, {
  intent: prepared.intent,
  signedXdr: signed.signedTxXdr,
});
const status = await api(`/transactions/${prepared.txHash}`);
// Poll with bounded backoff while PENDING/UNKNOWN. Refresh Schedule state only after finality.
```

For Postman, select the matching Schedule prepare request, set `scheduleNodeId` and
`scheduleWalletAddress`, sign `scheduleUnsignedXdr` unchanged outside Postman, paste
into `scheduleSignedXdr`, then submit that action with `scheduleIntent`. Do not mix
intents or envelopes from different actions. Omit `nodeId` from preparation when
using its unambiguous default; an empty nodeId is invalid.

## Recovery and replacement

Only one unresolved wallet intent is admitted per node across pause/resume/retrieve
and funding. Preparation conflicts return the existing `intent` and `txHash` in
`error.fields`; keep the original action so you can reconcile it.

Submit retries use the same intent and signed envelope. Duplicate, concurrent,
crashed or uncertain submissions look up the existing hash without another send.
A timeout, `UNKNOWN`, queue `REJECTED`, wallet denial or elapsed local expiry never
permits preparing a replacement: the envelope may already have been broadcast.

```ts
const recovered = await api(`/schedule/${originalAction}/reconcile`, {
  intent: originalIntent,
});
if (!recovered.replacementAllowed) {
  // Keep this intent; retain the original envelope, poll/back off, and report uncertainty.
} else {
  // SUCCESS/FAILED or ledger-proven EXPIRED cleared the reservation.
  // Refresh state and check whether the intended action still needs doing before preparing.
}
```

Ledger-proven expiry requires a closed ledger after the envelope's maxTime and
covered historical NOT_FOUND evidence. Lagging RPC/history gaps retain reservations.
See [wallet-control recovery](wallet-controls.md) for the full durable protocol.
Retirement refuses unresolved controls; developer tokens do not reopen retired service.

## Verification gate

Before announcing hosted participant support, record the deployed version, consenting
controller wallet, prepared intent/hash, pause and resume ledger finality/state, and
permitted retrieval's actual token, controller recipient and amount. Verify balance
change and remaining vested entitlement. Wallet secrets and signed XDR are excluded
from evidence and logs. Local tests do not establish hosted or testnet readiness.
