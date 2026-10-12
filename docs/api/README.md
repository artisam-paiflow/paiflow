# Developer API

For a complete frontend/backend integration without the starter, follow the [API quickstart](../hackathon/developer-api-quickstart.md). For wallet setup, flow deployment and the ready-wired starter, use the [Paiflow Guide](../hackathon/paiflow-guide.md). Both guides are event-neutral; this reference provides the detailed API contract.

Paiflow's `/api/v1` lets your backend run a deployed **deposit-triggered flow** (Pay, Split, condition or swap) and watch what it did on
chain, with no browser and no wallet integration on Paiflow's side. You send the deposit, the flow
runs (paying, splitting, routing or swapping on a real DEX) and you poll the events.

| Artefact                  | Where                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI 3.1 specification | Served at [`https://beta.app.paiflow.xyz/api/v1/openapi.json`](https://beta.app.paiflow.xyz/api/v1/openapi.json); source [`docs/api/openapi.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/openapi.json)                                                                   |
| Postman collection        | [`paiflow-api-v1.postman_collection.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json) (import by link: [raw file](https://raw.githubusercontent.com/artisam-paiflow/paiflow/develop/docs/api/paiflow-api-v1.postman_collection.json)) |
| This guide                | [paiflow.gitbook.io/paiflow-docs/reference/api](https://paiflow.gitbook.io/paiflow-docs/reference/api); source `docs/api/README.md`                                                                                                                                                                 |

{% hint style="warning" %}
**Testnet only.** The public instance at `https://beta.app.paiflow.xyz` runs on Stellar testnet. Every
account, asset and amount in this guide is a testnet one.
{% endhint %}

Use `https://beta.app.paiflow.xyz` as the app and API origin. `https://paiflow.xyz` also serves the API, but its app pages redirect to the beta app. `https://beta.paiflow.xyz` is the marketing homepage and does not serve `/api/v1`. The source OpenAPI specification and Postman defaults use the beta app origin; the live specification changes when the source update is deployed.

## How it works

A flow that starts at a **deposit trigger** can be executed: a contract that receives
`deposit(from, amount)` and passes the funds down the pipeline (a payer forwards them, a splitter
divides them, a condition routes them, a swapper exchanges them first). The steps after the trigger
can't be called directly (they only accept calls from the step before them), so "executing a flow"
means depositing into its trigger.

Flows that start with anything else (a subscription, webhook, payroll, timelock or oracle trigger)
run on their own schedule or callback, which a deposit can't start. Execute refuses them with a
`422` naming the step the flow starts with. A Pay or Split step in a dev-mode flow that has no
recipient yet also reverts, with a plain message: set the recipient first, then execute.

The deposit has to be authorized by the account the funds come from. That's you, so executing a
flow takes three steps:

1. **Prepare.** `POST /api/v1/deployments/{id}/execute` builds and simulates the deposit and returns
   an **unsigned** transaction envelope.
2. **Sign.** You sign that envelope with the `from` account's key, on your side.
3. **Submit.** `POST /api/v1/deployments/{id}/execute/submit` checks the envelope, sends it to the
   network, waits for the result and records it.

Then `GET /api/v1/deployments/{id}/events` returns the deposit and whatever the flow's later steps emit (payout, split, swap).

{% hint style="info" %}
**Execute deposits are signed by the caller.** Paiflow is non-custodial: your secret key never leaves your side and is
never sent to Paiflow. The sign step is always yours, and curl alone can't do it, which is why the
examples below use `stellar tx sign` or the Stellar SDK between the two calls. It also limits what a
leaked API token can do: prepare an envelope, and relay one that your key already signed. It can't
move funds on its own.
{% endhint %}

## Prerequisites

- **A confirmed deployment whose flow starts with a deposit trigger.** Build and deploy a flow such
  as `Receive XLM → Swap → Pay USDC` or `Receive USDC → Split` in the builder; its status must be `CONFIRMED`. Its id is in the deployment page URL
  (`/deployments/<id>`), where the **API access** panel also lives.
- **A deployment API token**, minted by the deployment's owner (see below).
- **A funded Stellar account** to deposit from. It pays the deposit and the transaction fee, and
  signs the envelope. On testnet, fund one with friendbot:
  `curl "https://friendbot.stellar.org?addr=G…"`. Depositing XLM needs nothing more; depositing
  another asset needs a trustline and a balance for it.
- **A trustline on the payout recipient** for the asset the flow pays out (for example USDC). A
  missing trustline makes the whole pipeline revert.

## Public demo access (testnet)

No account? One call gets you a working token for a shared demo flow, so every request in this
guide can be tried straight away:

```bash
curl -X POST https://beta.app.paiflow.xyz/api/v1/demo-token
```

```json
{
  "data": {
    "deploymentId": "6b1f0c52-3d4e-4a8b-9c7d-2e5f8a1b3c4d",
    "token": "pfk_4f1c9d2a7b8e3056c14fa9d7be205183cc47e6f90a2b5d38e71c406fa9b8d2e5",
    "expiresAt": "2026-09-18T15:04:05.000Z"
  }
}
```

Use those two values as `DEPLOYMENT_ID` and `PAIFLOW_TOKEN` in the quick start below. The token
lasts **60 minutes**; ask again for another. The demo flow is `Receive XLM → Swap to USDC → Pay`,
the same one the sandbox deploys.

{% hint style="warning" %}
**The demo deployment is shared, and your testnet XLM is spent.**

- Anyone else holding a demo token can read the events your deposit produces, including the account
  you deposited from. Fund a throwaway account with friendbot and never point this at one you care
  about.
- The swap proceeds are paid to a Paiflow-owned testnet account, not back to you. Nothing refunds
  the XLM you deposit.
- This is testnet only. The endpoint is off wherever `STELLAR_NETWORK=mainnet`, and the app refuses
  to boot in that combination.

{% endhint %}

The demo is for evaluating the API. For an isolated deployment, a recipient you control and a token
that does not expire in an hour, register, deploy your own flow and mint a token in the **API
access** panel — the rest of this guide is the same either way.

Send the demo token exactly as any other: `Authorization: Bearer pfk_…`. Note that a browser tab
signed in as the **Try the sandbox** identity is refused on `/api/v1`, so use curl, Postman or a
private window.

## Deployment API tokens

A token is bound to **one deployment**. Its supported operations depend on that deployment:
reading events, transaction status and capabilities; preparing/submitting deposits for On Receive
flows; and eligible payouts or relayer-authorized early releases. It grants no access to another
deployment, account data or admin routes.

The deployment's **API access** panel shows available operations and integration instructions
before you create a token. For HTTP Webhook flows, it also contains the callback URL and webhook
secret, with an escrow callback example and retry guidance. Callbacks use `x-webhook-secret`;
`pfk_` tokens authenticate `/api/v1` tracking and other supported operations. Keep these credentials
separate. Funding QR codes and wallet/manual controls remain in the deployment overview.
Subscription approval requires the configured subscriber's wallet consent; an API token does not
replace it. Only On Receive deployments show the deposit prepare/sign/submit example.

- **Minting.** The deployment's owner signs in, opens the deployment page and uses the **API access**
  panel. Tokens can only be minted for a `CONFIRMED` deployment, and a deployment can have at most 10
  active tokens of the owner's own. Tokens handed out by the public demo route are bounded and
  expired separately, and the panel neither lists nor counts them.
- **Shown once.** The full token (`pfk_` followed by 64 hex characters) is displayed only when it's
  created. Paiflow stores only a hash. Copy it into your secret store straight away.
- **Expiry and revocation.** A token can be given an expiry of 1 to 365 days, or none. Revoking a
  token in the panel takes effect on the next request.
- **Sending it.** `Authorization: Bearer pfk_…` is the only header accepted. Payroll's
  `x-dev-api-secret` and `pkdev_…` developer tokens don't work on `/api/v1`.
- **Refusals.** A missing, unknown, revoked or expired token, or a token for a different
  deployment, all get the same `401`, so a caller can't tell which it was.
- **Sandbox.** The **Try the sandbox** identity on the login page can't mint tokens or call
  `/api/v1`.
- **The demo token is the exception.** `POST /api/v1/demo-token` issues one without an account, for
  the shared demo deployment only, expiring after 60 minutes. See
  [Public demo access](#public-demo-access-testnet) above.

The owner-session routes behind the panel (`GET`/`POST /api/deployments/{id}/api-tokens`,
`DELETE /api/deployments/{id}/api-tokens/{tokenId}`) are in the OpenAPI document for completeness.
They take the owner's browser session, not a token.

## Quick start

Set these once:

```bash
export PAIFLOW=https://beta.app.paiflow.xyz
export DEPLOYMENT_ID=<deployment id>
export PAIFLOW_TOKEN=pfk_<64 hex>
export FROM=G...                  # the funded account that deposits and signs
export FROM_SECRET=S...           # its secret key; stays on your machine
```

### Read current Subscription state

On builds containing #911, an ordinary or Dev Subscription exposes
`GET /api/v1/deployments/{id}/subscription/state` with its deployment bearer token:

```bash
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/subscription/state" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

The `data` response contains `deploymentId`, `flowName`, `network`, `templateKind`,
`contractAddress`, `tokenContractAddress`, `subscriber`, `isCancelled`, `allowance`,
`setupRequired`, `asset` and `assetLabel`. Subscriber, token, cancellation and allowance
come from current on-chain reads; amounts are integer stroop strings. If a Dev subscriber
is unconfigured, `subscriber` is null, `setupRequired` is true and `allowance` is "0";
no allowance read is attempted. A configured subscriber can have zero allowance even
when setup is complete. Cancelled subscriptions remain readable.

`tokenContractAddress` identifies the deployed asset. `asset` is metadata from the
original graph only when it matches that token; otherwise it is null and `assetLabel`
is the token contract address. Payroll, unsupported or malformed deployments and
network mismatches are refused. Invalid/revoked/wrong-deployment tokens and inactive
service are refused before live reads. RPC errors are reported, never substituted
with zero or an active subscription. Responses are `no-store`; limit: **40/minute
per token**. These fields are live observations, not a guaranteed atomic ledger snapshot.

The token authorizes this read only. Continue using the configured subscriber's wallet
and existing [allowance workflow](../hackathon/participant-guide.md) for approval.
This endpoint neither charges nor cancels/reactivates a subscription. Hosted testnet
verification remains required before relying on a deployed version's support.

### Discover the deployment's capabilities

On builds containing the capabilities endpoint, check your deployment before choosing an integration:

```bash
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/capabilities" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

`data` contains `deploymentId`, `network`, `triggerType`, `inputAsset`,
`configurationSource: "deployment_snapshot"` and `operations`. The operation keys are
`execute`, `balances`, `events`, `transactions`, `releaseEarly`, `payouts`, `webhook`,
`subscriptionAllowance`, `subscriptionState` and `swapQuote`. Each has a `status`, `authentication`, `requirements` and `nodeIds`:

- **`supported`**: the integration path exists for the recorded deployment. This does not promise
  the next transaction will succeed; balances, deadlines, trustlines and simulation still apply.
- **`conditional`**: a candidate path exists, but its own state/preparation endpoint must establish
  eligibility. Payouts must verify current connectivity, amounts and balances; subscription approval
  must verify subscription classification, the configured subscriber and active state.
- **`unsupported`**: no matching path can be established from the recorded deployment metadata.

Standard On Receive flows support `execute` with configured recipients; they report `payouts` as
unsupported. Dev payout candidate `nodeIds` include only mutable crypto Pay nodes reachable through
immediate Split or amount-condition paths. A delayed path or swap is not a payout candidate.
`releaseEarly.nodeIds` lists timelock branches, excluding strict Hold contracts. For webhook flows,
`execute` is unsupported and `webhook` uses **`webhook_secret`**, obtained separately by the owner.
Subscription allowance uses **`subscriber_wallet`** consent; the discovery token does not authorize
either operation.

Discovery makes no RPC calls and sends no transactions. `inputAsset` is the **initial snapshot
metadata**, or null when unavailable; Dev mutations may have changed it. Discovery never returns
webhook secrets, API credentials, recipient/subscriber addresses, bank details, KYC or notification
settings. Responses are `no-store`, require a confirmed deployment on this environment's network,
and are limited to **60 requests/minute per token**. A network mismatch returns 422. Use discovery
when selecting an integration, rather than polling it as a live balance or readiness check.

### 1. Prepare

`amount` is in **stroops** of the flow's input asset, as a string: 1 XLM = `10000000`.
A terminal chain of fixed Pay steps requires its exact total; below or above that total returns
`422 VALIDATION`. Fixed Pay steps before a variable step require at least their total. Fixed Split
supports partial deposits towards its payout batch and keeps residual funds for the next batch;
percentage routes retain variable input. Issued-asset transfers require trustlines on both sender
and recipient accounts. Missing-trustline responses identify the affected account when the network
supplies it; otherwise the explanation does not guess which wallet is missing the trustline.

```bash
curl -sS -D prepared.headers -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":\"10000000\",\"from\":\"$FROM\"}" | tee prepared.json
PREPARATION_REQUEST_ID=$(awk 'tolower($1)=="x-history-request-id:" {gsub("\r", "", $2); print $2}' prepared.headers)
```

```json
{
  "data": {
    "xdr": "AAAAAgAAAACYBFftt4XVT7U0jiCPtYE5cDNPGXNUCOOo7L0FRPhTjAAK/F4AR4Yw…",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "network": "testnet",
    "expiresAt": "2026-09-18T02:34:52.000Z"
  }
}
```

The simulation runs before anything comes back. If the deposit would fail (an unfunded `from`, a
missing trustline, no liquidity), you get a `422` explaining why, and nothing is signed or spent.
Sign and submit before `expiresAt`, which is about three minutes after preparing; after that the
network refuses the envelope and you prepare again.

{% hint style="warning" %}
`expiresAt` is about three minutes out, so stage the signing step before you call prepare: have the
`stellar tx sign` command ready to paste into, or hold the key in an SDK script. If the envelope
expires, call prepare again — nothing is spent and the old envelope simply stops being accepted.
{% endhint %}

### 2. Sign

With the [Stellar CLI](https://developers.stellar.org/docs/tools/cli):

```bash
jq -r .data.xdr prepared.json > unsigned.xdr
stellar tx sign --sign-with-key "$FROM_SECRET" --network testnet "$(cat unsigned.xdr)" > signed.xdr
```

Or with [`@stellar/stellar-sdk`](https://www.npmjs.com/package/@stellar/stellar-sdk) in Node:

```ts
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

const base = `${process.env.PAIFLOW}/api/v1/deployments/${process.env.DEPLOYMENT_ID}`;
const headers = {
  Authorization: `Bearer ${process.env.PAIFLOW_TOKEN}`,
  "Content-Type": "application/json",
};

const prepareResponse = await fetch(`${base}/execute`, {
  method: "POST",
  headers,
  body: JSON.stringify({ amount: "10000000", from: process.env.FROM }),
});
const preparationRequestId = prepareResponse.headers.get("x-history-request-id");
const prepared = await prepareResponse.json();

const tx = TransactionBuilder.fromXDR(prepared.data.xdr, prepared.data.networkPassphrase);
tx.sign(Keypair.fromSecret(process.env.FROM_SECRET!));

const submitted = await fetch(`${base}/execute/submit`, {
  method: "POST",
  headers: {
    ...headers,
    ...(preparationRequestId ? { "x-preparation-request-id": preparationRequestId } : {}),
  },
  body: JSON.stringify({ signedXdr: tx.toXDR() }),
}).then((r) => r.json());
```

Always sign with the `networkPassphrase` the response gives you. An envelope signed for a different
network is rejected.

### 3. Submit

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit" \
  -H "x-preparation-request-id: $PREPARATION_REQUEST_ID" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"signedXdr\":\"$(cat signed.xdr)\"}"
```

```json
{
  "data": {
    "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
    "status": "SUCCESS",
    "ledger": 4735030
  }
}
```

What to expect:

- **It waits.** By default the call waits up to about 25 seconds for a final result. Add
  `?wait=false` to get `PENDING` back as soon as the network accepts the transaction. At most three
  waiting calls per token are held open at once; a fourth still sends its transaction but returns
  `PENDING` straight away, exactly as `?wait=false` would. Resubmit the same `signedXdr` to check it.
- **A `502` here does not mean the transaction was not sent.** Each RPC call times out at ten
  seconds, so a stalled RPC during the wait ends the call with `502 UPSTREAM_RPC` even though the
  envelope was already broadcast. Treat it like `PENDING`: submit the same `signedXdr` again, or
  poll events, rather than preparing a new one.
- **`status` is one of three values.**
  - `SUCCESS`: the flow ran. Look up `txHash` on
    [stellar.expert](https://stellar.expert/explorer/testnet).
  - `PENDING`: accepted but not final yet. Submit the **same** `signedXdr` again to check.
  - `FAILED`: the transaction reached the network and failed. The response is still HTTP `200`, and
    `error` says why, for example
    `{ "code": "txTooLate", "message": "The transaction's 180-second window expired … Prepare it again." }`.
- **Safe to retry.** Submissions are idempotent on the envelope hash. Sending the same envelope
  twice never executes the flow twice; the second call reports what happened to the first.
- **Only this flow's deposit is accepted.** The envelope must hold exactly one `deposit` call on
  this deployment's trigger contract. Anything else, including a fee-bump envelope, is refused with
  `422`. A token for one flow can't be used to submit an unrelated transaction.
- **It's audited.** Every prepare, submit and confirmation is recorded in Paiflow's audit log
  against the deployment owner, with the token id. Paiflow holds these records; the app does not
  show them to the owner yet.

### 4. Poll events

```bash
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?limit=50" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

```json
{
  "data": {
    "items": [
      {
        "id": "167054b2-8cb6-4055-b8fd-4a7ca190c002",
        "eventId": "0020336798995623936-0000000001",
        "kind": "RECEIVE",
        "topic": "deposit",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "from": "GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM",
          "asset": "XLM",
          "amount": "100000000"
        }
      },
      {
        "id": "c579376d-7cdc-4d22-a3b1-be49c3b2972b",
        "eventId": "0020336798995623936-0000000010",
        "kind": "PAYOUT",
        "topic": "pay",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "asset": "USDC",
          "payment": "10584167",
          "recipient": "GCVJW2CEXCJ6WPRYAMYFIDA6LLIYX5NJIJ6T76NW2BXQXFNPV2V62J7H"
        }
      },
      {
        "id": "94cf0bbf-54a6-43c7-9e55-d48a6b688ac7",
        "eventId": "0020336798995623936-0000000011",
        "kind": "PAYOUT",
        "topic": "swap",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "assetIn": "XLM",
          "amountIn": "100000000",
          "assetOut": "USDC",
          "amountOut": "10584167"
        }
      }
    ],
    "nextCursor": "NDczNTAzMHwwMDIwMzM2Nzk4OTk1NjIzOTM2LTAwMDAwMDAwMTE",
    "hasMore": false
  }
}
```

**What this endpoint returns.** These are the events Paiflow decoded for this deployment's
contracts, as recorded in its own database. It is not a raw feed of the chain:

- **No duplicates.** Each event appears exactly once, keyed by the network's `eventId`.
- **Oldest first.** Events are ordered by `(ledger, eventId)`, and pagination only moves forward.
- **About 10 to 20 seconds behind.** When the deployment's events were last collected from the
  network more than 10 seconds ago, a call collects them first and waits up to 5 seconds for that,
  so while you keep polling, an event usually shows within 10 to 20 seconds of its ledger closing,
  however it was submitted: through `execute/submit`, by a wallet paying the contract directly, or
  from a scanned QR. Collection is shared by everyone polling the deployment, runs one at a time,
  and starts no sooner than 10 seconds after the last one ended, so polling faster than that does
  not help. A call that lands while a collection is already running, or when the network is slow,
  answers with what is recorded and the event shows on a later call; a background poller also
  collects every minute. A `SUCCESS` from `execute/submit` records that transaction's events before
  it returns, so `?txHash=<txHash>` right after a submit already has them.
- **Swaps.** A swap has `kind: "PAYOUT"` and `topic: "swap"`. Its `data` is
  `{ assetIn, assetOut, amountIn, amountOut }`, with amounts in stroops as strings. `assetIn` and
  `assetOut` are the asset's **symbol** where the flow names one (`"XLM"`, `"USDC"`) and the raw
  asset contract address otherwise, so parse for either.

**Polling with the cursor.** Keep the `nextCursor` from each response and send it back as `cursor`.
While `hasMore` is `true`, ask again straight away. Once it's `false` you're caught up: wait a while
and ask again with the same cursor. Once the deployment has any events, `nextCursor` is never null.
On an empty page it hands your cursor back, so you can always store it. It is null only when the
deployment has no events yet and you sent no cursor.

```bash
CURSOR=""
while true; do
  PAGE=$(curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?limit=100${CURSOR:+&cursor=$CURSOR}" \
    -H "Authorization: Bearer $PAIFLOW_TOKEN")
  echo "$PAGE" | jq -c '.data.items[]'
  CURSOR=$(echo "$PAGE" | jq -r '.data.nextCursor // empty')
  [ "$(echo "$PAGE" | jq -r .data.hasMore)" = "true" ] || sleep 30
done
```

Treat the cursor as opaque. An empty `cursor=` or a cursor that has been modified gets a `422`; it
never silently starts again from the first event.

### 5. Release a timelock branch early

A flow with a **timelock branch** ("pay on delivery, refund the client after the deadline") pays
its _after_ side by itself once the deadline passes. To pay the _before_ side when the work is
delivered, call:

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/release-early" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "nodeId": "timelock-branch-1" }'
```

Nothing is signed on your side: the token authorises the call and Paiflow's relayer sends the
release. The response returns once the transaction is final:
`{ "data": { "nodeId": "…", "txHash": "…", "ledger": 1842917 } }`.

- `nodeId` names the branch. It is required when the deployment has more than one and may be
  omitted (or the body left empty) when it has one.
- **After the deadline** the contract refuses the before side and you get a `422 VALIDATION`
  ("The deadline has passed; this condition now releases to its after side automatically"). A
  condition that holds no funds is also a `422`.
- The deployment's owner can do the same from the **Release now** button on the deployment page.

## Errors

Successful responses are `{ "data": … }`. Errors use one shape on every route:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Invalid input",
    "fields": { "amount": ["Must be a whole number of stroops"] }
  }
}
```

`fields` appears on validation errors. `details`, when present, carries raw technical detail such
as a Soroban simulation diagnostic.

| `code`               | HTTP | When                                                                                                                                              |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`    | 401  | Token missing, unknown, revoked, expired, or for another deployment (token management: no signed-in session)                                      |
| `INSUFFICIENT_FUNDS` | 402  | The `from` account doesn't exist on this network (prepare)                                                                                        |
| `FORBIDDEN`          | 403  | Not allowed for this caller (sandbox), or the public demo is not enabled on this instance (demo token)                                            |
| `NOT_FOUND`          | 404  | A malformed deployment id, or (execute) a deployment that isn't confirmed                                                                         |
| `CONFLICT`           | 409  | Already 10 active tokens, or a payout is preparing or can still execute                                                                           |
| `VALIDATION`         | 422  | Bad body or query; a deposit the simulation rejects; a flow that doesn't start with a deposit trigger; an envelope that isn't this flow's deposit |
| `RATE_LIMITED`       | 429  | Too many requests in the window (see below); on the demo token, also when the instance has no shared rate limiter                                 |
| `INTERNAL`           | 500  | Unexpected server error; on the demo token, also a deliberate refusal when the demo flow is misconfigured, with the reason logged                 |
| `UPSTREAM_RPC`       | 502  | The Stellar RPC call failed, or the network was too busy to accept the transaction; retry, resubmitting the same envelope                         |

Every response carries an `x-request-id` header. Include it when you report a problem.

Wrapped deployment API responses also include `x-history-request-id`, a server-generated
analytics request UUID. Save it with the prepared envelope; send it as
`x-preparation-request-id` on `/execute/submit` or `/payouts/submit`, including retries.
A new preparation gets a new ID. This optional metadata does not authorize or deduplicate
transactions. Missing or unmatched links do not prove abandonment. Forward the header
through your own backend to the browser when signing there, keeping the bearer token
server-side. The [API analytics report](../analytics/api-request-history-v1.md) exposes
verified linkage coverage without treating unlinked requests as drop-off.

## Rate limits

Token-authenticated endpoints are counted **per token**, per endpoint, in fixed 60-second windows.
The two public endpoints carry no token, so they are counted per client IP instead, and the demo
token also has an instance-wide hourly cap. Going over returns `429 RATE_LIMITED`. The demo token's
instance-wide cap fails closed: on an instance without a shared rate limiter it refuses every
request with `429`, because a per-process count cannot bound how many live credentials the route
hands out across replicas.

A token that was issued, or has worked, in the last 30 days is subject only to the per-token limits
below, whatever else is happening on your network. Other tokens (guesses, typos, revoked ones) are
limited per client address before they are looked up, so a room of teams sharing one network (a
hackathon venue's Wi-Fi) does not pay for one broken script:

- A token refused in the last minute is refused again with the same `401`, without a lookup.
- **6,000 lookups per minute** of tokens not seen before, from one address.
- **After 300 failed authentications in 10 minutes** from one address (a missing, malformed,
  unknown, revoked or expired token, or one for another deployment), **60 lookups per minute** of
  tokens not seen before, and `429` for the rest. If you see
  `Too many failed authentication attempts from this address`, the token you are sending is the one
  to check.

| Endpoint                                      | Limit                                                     |
| --------------------------------------------- | --------------------------------------------------------- |
| `POST …/execute`                              | 30 per minute                                             |
| `POST …/execute/submit`                       | 30 per minute                                             |
| `POST …/release-early`                        | 10 per minute                                             |
| `GET …/events`                                | 120 per minute                                            |
| `GET …/subscription/state`                    | 40 per minute                                             |
| `GET …/capabilities`                          | 60 per minute                                             |
| `GET /api/v1/openapi.json`                    | 60 per minute per client IP (no token)                    |
| `POST /api/v1/demo-token`                     | 3 per hour per client IP, 60 per hour instance-wide       |
| Token management (owner session, not the API) | 20 per minute per signed-in user, across all three routes |

## Postman

Import [`paiflow-api-v1.postman_collection.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json)
(in Postman, **Import → Link** and paste the
[raw file URL](https://raw.githubusercontent.com/artisam-paiflow/paiflow/develop/docs/api/paiflow-api-v1.postman_collection.json)), then:

1. Fill in the collection variables `deploymentId`, `apiToken` and `from`, and adjust `amount`.
   `baseUrl` is already `https://beta.app.paiflow.xyz`.
2. Run **Prepare execute**. It stores the envelope in `executeUnsignedXdr` and the response ID in `executePreparationRequestId`.
3. Sign it on your side (`stellar tx sign --sign-with-key S… --network testnet "<executeUnsignedXdr>"`) and
   paste the result into `executeSignedXdr`.
4. Run **Submit execute**. It sends the saved preparation ID and stores `txHash`. Retries reuse that ID. Payout requests use separate `payoutUnsignedXdr`, `payoutSignedXdr` and `payoutPreparationRequestId` variables. A successful new preparation replaces only its operation's unsigned envelope and ID and clears its previous signed envelope. Failed preparations preserve the previous payment's retry data.
5. Run **List events**. It stores `nextCursor` in `cursor`; enable the `cursor` query parameter to
   page forward.

Each request has saved example responses.

## Sample payloads

{% hint style="info" %}
The `xdr`, `txHash` and event values above are from the 18 September evidence run, with the `xdr`
shortened. The complete record of that run, with the unsigned and signed envelopes, the responses
and the transaction on stellar.expert, is in the D2 evidence pack at
[`docs/instawards/evidence/d2/`](../instawards/evidence/d2/README.md).
{% endhint %}

## Trying the API

Anyone can drive the full sequence on testnet, with no account. Three commands from a cold start:

```bash
# 1. A throwaway account, funded by friendbot
stellar keys generate reviewer --network testnet --fund
export FROM=$(stellar keys address reviewer)

# 2. A demo token and the deployment it reaches
eval $(curl -sX POST https://beta.app.paiflow.xyz/api/v1/demo-token |
  jq -r '.data | "export DEPLOYMENT_ID=\(.deploymentId) PAIFLOW_TOKEN=\(.token)"')

# 3. Run the quick start above: prepare → sign → submit → poll events
```

Read [Public demo access](#public-demo-access-testnet) first: the demo deployment is shared, and
the XLM you deposit is paid out to a Paiflow-owned testnet account rather than back to you.

Three ways to check the path without running it:

- the curl transcript, audit log rows and transaction link in
  [`docs/instawards/evidence/d2/`](../instawards/evidence/d2/README.md);
- the [Postman collection](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json), whose first request mints a demo
  token and fills in the rest of the variables for you;
- this guide and the [OpenAPI document](https://beta.app.paiflow.xyz/api/v1/openapi.json).

## Running the demo deployment yourself

The demo needs one `CONFIRMED` swapper deployment, owned by an ordinary account, that the operator
points the endpoint at:

1. Sign in as a dedicated non-sandbox account.
2. Build `Receive XLM → Swap to USDC → Pay`, paying the full amount to an address that holds a USDC
   trustline (`SANDBOX_DEMO_RECIPIENT` in `lib/flows/starter.ts` is the one the sandbox uses, and is
   already funded on testnet). `execute` simulates the whole pipeline down to the final transfer, so
   a recipient without a trustline makes every demo call fail.
3. Deploy it from that account's own wallet and wait for `CONFIRMED`.
4. Set `DEMO_API_ENABLED=true` and `DEMO_API_DEPLOYMENT_ID=<id>` on the testnet service, and
   redeploy.
5. Run `pnpm demo:check`. The endpoint answers with one generic refusal for every misconfiguration,
   deliberately, so this script is how you find out which one it is.

## Keeping the spec in sync

The OpenAPI document is a TypeScript object in `lib/api/v1/openapi.ts`. After changing it, run
`pnpm api:openapi` to regenerate `docs/api/openapi.json`. `tests/unit/api/v1/openapi.test.ts` fails
if the committed copy falls behind, if a route under `app/api/v1` has no entry, if an example stops
matching its Zod schema, or if the Postman collection misses a v1 request.

## Per-payment payouts

**Hackathon availability:** Dev mode will stay disabled for the duration of the hackathon. These endpoints require Dev mode and are unavailable during the event. Use `execute` with the recipients configured in your standard deployment.

For a deposit-triggered dev flow, `POST /api/v1/deployments/:id/payouts` accepts
`{ "from": "G…", "amount": "1000000000", "recipient": "G…", "nodeId": "pay" }`.
`nodeId` is optional when there is only one deployed `PAYER_DEV`. Sign the returned `xdr` with
`from` and the supplied network passphrase, then post `{ "signedXdr": "…" }` to
`POST /api/v1/deployments/:id/payouts/submit` with the same deployment token. The response adds
`nodeId` to execute's preparation fields. Payout deposits have a **60-second validity window**;
`execute` keeps 180 seconds. Sign and submit before `expiresAt`. Submission keeps execute's bounded wait,
`?wait=false`,
and `SUCCESS | PENDING | FAILED` conventions.

The selected Pay must receive this deposit through immediate amount conditions or fixed Split,
with no delayed or unsupported steps. Eligibility uses the deployed graph and current on-chain
configuration, resolving every address through `pipelineSnapshot`. A fixed Split is accepted only
with zero token and accumulated balances, positive fixed crypto recipients, exactly one next
step, and an incoming deposit greater than its fixed total. It pays its roster and immediately
forwards the surplus to the next step, resetting its accumulator. Percentage Split consumes the
deposit; shortfalls accumulate; neither reaches the selected Pay and both are refused.

If Pay uses **Fill value via API**, payouts configures it to 100%. Otherwise its current value is
preserved. Fixed Pay pays `min(incoming, configured cap)`, so incoming must be at most that cap;
percentage Pay must consume all incoming funds. This refers to the amount that reaches Pay after
upstream fixed payouts. Pay must have zero existing balance. Any account/trustline refusal or
inconclusive check blocks recipient mutation, including missing accounts for native XLM. Matching
recipient and payment configuration skip mutation.

Functioning Redis is required. A unique holder protects each deployment while preparing,
configuring and awaiting the exact prepared deposit. Configuration hashes are saved before
submission. A timeout, network error or `PENDING` result retains protection: another request
cannot change the recipient until the configuration/deposit is final or a closed ledger's time
passes its transaction validity window. **Wall-clock Redis expiry is insufficient.** `CONFLICT`
means an earlier payout may still execute. When a held transaction is known, the 409 includes
`Retry-After`: seconds until its `maxTime`, rounded up with a minimum of 1. This is advisory;
ledger time can lag, so retrying may still return 409. An abandoned deposit permits a new prepare
only once ledger-time expiry is proved. For a submitted payout, retry its same signed envelope.
Signature changes are allowed; transaction-body changes are refused. Confirmed
retries remain available for seven days and cannot release a newer holder. A send refusal can
return `FAILED` without releasing protection if finality is still uncertain.

Coordination covers these payout endpoints only. **Direct deposits, `execute`, legacy dev mutation
routes and owner-signed transactions bypass it** and must not run concurrently with payouts.
Keep Redis coordination records durable; never flush or evict them while transactions can still
land. This feature adds no coordination to those other surfaces.

Maintainer staging check: run two successive payouts to different recipients and verify both
recipient destinations and all pipeline balances. No staging transaction was performed by these
tests.

## Recover a pending transaction

Use the deployment's `pfk_` token with `GET /api/v1/deployments/{id}/transactions/{txHash}`:

```bash
curl "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/transactions/$TX_HASH" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

The response includes `data.txHash`, `network`, `status`, and a confirmed `ledger` when available.
`SUCCESS` and `FAILED` are final; `FAILED` includes `error.code: ONCHAIN_FAILED`.
`REJECTED` reports a recorded submission refusal, rather than an on-chain failure.
`PENDING` means acceptance is known but finality is unavailable. `UNKNOWN` means the attempt is
attributed to this deployment but neither acceptance nor finality is established. Neither an
unknown state, missing events nor an RPC error makes a fresh payment safe: keep the original hash
and resolve its outcome rather than building another payment.

Poll after 2 seconds, then back off exponentially with jitter to 30 seconds. Stop on finality;
honor `Retry-After` on 429 and back off on 502. Limits are 60 lookups/minute per token across all
hashes, plus 60 RPC reads/minute per deployment across tokens. Production requires shared Redis
for the RPC budget and returns 502 while it is unavailable. RPC reads have a 10-second timeout.
This GET never sends a transaction or runs the pipeline; it may reconcile existing outcome records.

Coverage includes recorded execute attempts, queued webhook callbacks and early releases with an
audit record, and ingested deployment events. A submission outside Paiflow can be attributed if
its RPC envelope directly invokes a contract in the deployment's pipeline on this network.
Indirect calls and transfers to a contract alone cannot establish attribution. Unattributed hashes
return 404; this does not prove the transaction failed or was never submitted. Deployment tokens
cannot read another deployment's records.

Confirmation audit actions alone establish attribution but do not supply retained finality;
if their RPC envelope and any terminal record/event are unavailable, lookup returns `UNKNOWN`.

RPC history is limited by the provider. Stored terminal outcomes and ingested events remain
readable after expiry; other historical transactions may be unavailable. A previously accepted
transaction can remain `PENDING` after it falls outside RPC history until further evidence is
available. This endpoint does not guarantee historical recovery or webhook retry idempotency.

## Retry webhook rewards safely

Deploy a standard **HTTP Webhook → Pay full amount** (or Split) flow, copy its URL and
webhook secret from **API access** on the authenticated owner deployment page, and fund it through
`/trigger/{deploymentId}` with a wallet-signed deposit. Funding does not execute the flow.
The recipients remain configured in the deployment; Dev mode is not required.

Send the callback from your server after verifying the completed task. Use one stable key
per logical event and reuse that key and payload for every retry:

```bash
curl -X POST "$PAIFLOW/api/webhooks/$DEPLOYMENT_ID" \
  -H "x-webhook-secret: $PAIFLOW_WEBHOOK_SECRET" \
  -H "Idempotency-Key: task-completed-42" \
  -H "Content-Type: application/json" \
  -d '{"escrow":true,"amount":"100000000"}'
```

This requests 10 tokens from the pre-funded pool. Omitting `amount` or using `"0"` releases
all available funds. The relayer signs the release; the callback secret is separate from
`pfk_`. Keep both credentials server-side.

A keyed response includes `{ data: { attemptId, network, status, txHash?, ledger?, error? } }`.
HTTP 202 with `Retry-After: 2` means `PENDING` or `UNKNOWN`; HTTP 200 reports finality or a
submission/preparation rejection. Never treat HTTP success as payout confirmation.
Repeat the same callback to check its existing attempt, or use the deployment's `pfk_`
token with the transaction lookup endpoint once a hash is available. Back off with jitter,
honor 429 `Retry-After`, and retry reads after 502. Callback rate limit: 20 requests/minute
per deployment/client IP; replays also share the deployment's transaction RPC budget.

Keys accept 1–128 letters, digits, dots, underscores, colons or hyphens, are case-sensitive,
and are scoped to a deployment. Changed effective arguments return 409. Stroop strings are
normalized (`"000100"` equals `"100"`); omitted escrow amount equals zero. Escrow ignores
`from` and `auth`; native non-escrow execution fingerprints its source and signed auth entries.
No callback bodies, secrets or signed envelopes are stored in the attempt table.

The database reserves the key before preparation and persists the transaction hash before
sending. Concurrent callbacks and later retries cannot prepare or send another transaction
for that event. Keyed sends also disable the legacy sequence-error rebuild loop. There is
**no automatic key expiry, deletion or lease takeover**; deployment deletion removes its
attempts, and event keys must not be purged while the deployment remains usable. An
interrupted worker before a hash is recorded can leave `UNKNOWN` without a hash indefinitely.
An uncertain send retains the original hash. Missing RPC history does not prove failure;
operator investigation is required for unrecoverable attempts. Never switch to a fresh key
or an unkeyed callback merely because an attempt is uncertain.

Unkeyed requests keep their existing behavior: each callback can create another payout.
Idempotency covers only callers reusing the same key; it does not deduplicate different event
keys, operator releases or other funding/execution paths, and is not an unconditional
exactly-once payout guarantee. Both new migrations must be applied before rollout; only
isolated local tests have run, with no live webhook payout or application database migration.

## Deployment contract balances

The source API adds `GET /api/v1/deployments/{id}/balances` with the deployment's
`Authorization: Bearer pfk_…` token. This endpoint is independent of execute: a
Schedule or Webhook deployment can read its funding pool without an owner session.
Check `operations.balances` in capabilities; `conditional` identifies candidate
nodes and does not establish live RPC availability. Hosted testnet verification
of this new endpoint remains pending; check the deployed capabilities and OpenAPI
before using it in a participant app.

```bash
curl "$BASE_URL/api/v1/deployments/$DEPLOYMENT_ID/balances" \
  -H "Authorization: Bearer $API_TOKEN"
```

The `{ data }` response contains `deploymentId`, `network`, `nodes`, `totals` and
`freshness`. Each node names its `nodeId`, `templateKind`, deployed
`contractAddress` and current `tokenContract`, with `balanceStroops` as an integer
string, `readAt`, `stale`, and an optional generic `error`. Token contract addresses
are asset identity; display asset labels from the original graph may be stale.
Swap nodes report separate input and output token balances. Only the selected
contract's configured token balances are read: account balances, recipients,
credentials and the private graph are not returned.

Candidates include Schedule, Webhook, time conditions, oracle conditions, Pay,
Split and Swap. Mutable Pay/Split reads require Dev mode enabled and read the
current on-chain asset. Multisig, Payroll and other unsupported kinds are excluded;
when they coexist with supported nodes, their error entries make totals incomplete.
An invalid or ambiguous pipeline, more than 64 candidate contracts, or no supported
target returns 422. An unconfirmed deployment returns 404; network mismatch returns 422. Invalid, revoked, expired, wrong-deployment or retiring/retired tokens return
the same generic 401. The service boundary also rejects retirement races.

`totals` sums successful reads per token contract across the supported holding
nodes only. It is not all customer funds. Always check
`freshness.totalsComplete`: a failed/unresolved/unsupported target has a null
balance and `stale: true`, never a fabricated zero. `status` is `fresh` if all
requested holding targets succeeded, `partial` if only some succeeded, or `stale`
if none succeeded. Partial totals omit failed targets. Reads are independent
simulations, not an atomic ledger snapshot.

This is display data, not Schedule payout availability, vested/unvested amounts,
or evidence of successful payment. Use transaction status and events to check a
payment. Genuine zero balances have an integer string `"0"`, a read timestamp and
`stale: false`.

Poll no faster than every 10 seconds. The per-token route limit is 30/minute; a
10-second cache and in-process single-flight combine callers across tokens.
`cached` indicates a cached response and the original `readAt`/`attemptedAt`
timestamps remain intact. Live reads use four workers, at most 64 contracts and a
25-second scheduling deadline, followed by completion of in-flight RPC calls
(10 seconds each; a lazy account lookup plus balance simulation can take up to
20 seconds beyond the scheduling deadline). A deployment-wide Redis refresh lease spans replicas; a
replica without a cached result returns 429 while another holds that lease.
Configured but unavailable Redis refuses new refreshes with 429. Without Redis,
coordination is process-local. A shared process admission queue also bounds RPC
refreshes across deployments. Honor `Retry-After` for overload; retrying an error
must never be interpreted as permission to send another payment.

## Wallet-authorized deployment controls

The shared [wallet control foundation](wallet-controls.md) documents the preparation,
submission and recovery protocol for future wallet-authorized controls; it does not
by itself expose cancellation/reactivation routes.

## Deployment-specific Swap estimates

The source API adds `GET /api/v1/deployments/{id}/swap-quote?amountStroops=10000000`
with this deployment's `Authorization: Bearer pfk_…` token. Hosted availability and
quote-versus-completed-swap testnet verification remain pending; verify the live
OpenAPI document before integrating a deployed instance. Discovery exposes
`operations.swapQuote` as conditional with candidate deployed `nodeIds`.

If several standard Swap nodes exist, pass `nodeId`. The amount is the input **at
that node**, which may differ from the deposit amount after upstream splits or
conditions. Contract addresses come from `pipelineSnapshot`; live getters determine
the input/output token contracts, router and slippage. Caller-selected assets,
routes, router or slippage overrides are rejected. The deployed router must match
the environment's configured router. Unsupported or ambiguous nodes return 422.

The response contains `amountInStroops`, `amountOutStroops` and
`amountOutMinStroops` as exact integer strings, authoritative token contract
addresses, `slippageBps`, `readStartedAt`, `quotedAt`, `freshness:"live"`,
`estimate:true` and `scope:"selected_node"`. Live means reserves/configuration were
read during this request, using successive simulations rather than an atomic
ledger snapshot. It does not guarantee future freshness. The estimated minimum
uses pool spot output less the deployed slippage, matching the contract's
arithmetic at quote time. `meetsMinimumAtQuote:false` signals the estimated router
output is below that estimate; true does not prove execution readiness.

Quotes predict one node, never an entire flow or guaranteed recipient payout.
Final transaction preparation, simulation and chain execution determine whether a
swap succeeds and its actual amount. Quote reads never sign or submit a transaction
and preserve the signed-in builder quote endpoint. Responses use `Cache-Control:
no-store`; RPC failures return errors, never fabricated zero amounts.

The endpoint permits 20 requests/minute per token and 20/minute per deployment
across tokens. Production requires a functioning shared Redis RPC budget; missing
coordination returns 502. Each request performs four configuration getter calls
and at most five pool/router calls. Back off on errors and honor `Retry-After` on 429. Retiring and retired deployments are unavailable to deployment tokens.
