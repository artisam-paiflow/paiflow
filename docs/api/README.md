# Developer API

For one server credential across explicitly selected existing owned deployments, see the [developer-token guide](developer-tokens.md). SDK `0.2.0` supports developer credentials and scoped discovery with a backend implementing OpenAPI revision `1.1.0`; SDK `0.1.0` does not include these additions. Existing deployment-only integrations remain supported. See the [SDK release record](../sdk/release-checklist.md) for registry availability.

For typed Node integrations with existing deployments, use the [SDK README](../../packages/sdk/README.md) for the published `@paiflow/sdk@0.2.0` Node beta (October 16, 2026).

This README is the detailed HTTP API reference, including a [custom browser/server example](#custom-browser-and-server-integration). For the main end-to-end wallet, flow, deployment and SDK integration walkthrough, use the [Paiflow Guide](../hackathon/paiflow-guide.md). Event rules and resource links belong in the event primer. The primer and Paiflow Guide are the two participant PDF resources; SDK and API details are maintained as GitHub Markdown.

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

## Hosted testnet verification

The October 14–15, 2026 SDK rehearsals ran against `https://pinkraft.xyz` in the
Railway **testing** environment on Stellar **testnet**. The dated reports record
the exact hosted revisions, deployed contracts, wallet consent, transaction hashes
and independent ledger results. They do not establish current availability at the
beta origin above, staging or mainnet; check the target build, deployment
capabilities, contract revision and live state before integration.

| Workflow          | Recorded live result                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funding           | Schedule top-up and Webhook pool funding confirmed on-chain.                                                                                                                                                                                             |
| Schedule controls | Controller-signed pause, resume and permitted retrieval confirmed; the initial 1 XLM funding was retrieved with matching recipient/amount and zero remaining balance.                                                                                    |
| Subscription      | Public wallet allowance approval, a manually invoked cron charge with matching 0.1 XLM payout, and subscriber-signed cancellation/reactivation confirmed on the fresh current-WASM fixture. Cancellation left zero allowance; reactivation granted none. |

These results are in the [initial SDK report](../testing/2026-10-14-sdk-live-verification.md).
The [published-package follow-up](../testing/2026-10-15-sdk-broader-testing.md)
also confirmed Schedule funding/full cancellation refund and Subscription
cancellation preventing an unpaid first charge. Its **additional positive
Subscription charge and first due Schedule claim remained fee-blocked**:
unsigned estimates of **42.6086882 XLM** and **27.2468293 XLM**, respectively,
exceeded the **1 XLM** ceiling, so neither positive payout attempt reached cron
POST, signing or submission. [Issue #990](https://github.com/webnxt-2030/pinkraft/issues/990)
tracks that remaining work. The earlier successful Subscription charge does not
complete these later tests. Unattended scheduling was not configured or verified.
The earlier report's retired lost-wallet fixture retains its separately documented
allowance limitation; fresh-fixture cleanup does not resolve that historical state.

The [SDK release record](../sdk/release-checklist.md) confirms that the published
beta's runtime/declarations match the live-tested candidate. Package publication
and local tests do not establish universal hosted or on-chain support.

## How it works

A flow that starts at a **deposit trigger** can be executed: a contract that receives
`deposit(from, amount)` and passes the funds down the pipeline (a payer forwards them, a splitter
divides them, a condition routes them, a swapper exchanges them first). The steps after the trigger
can't be called directly (they only accept calls from the step before them), so "executing a flow"
means depositing into its trigger.

Flows that start with anything else (a subscription, webhook, payroll, timelock or oracle trigger)
run on their own schedule or callback, which a deposit can't start. Execute refuses them with a
`422` naming the step the flow starts with. Configure every Pay and Split recipient before deploying the flow.

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
leaked API token can do: prepare an envelope, and relay one that your key already signed. Supported relayer operations, including early release, have their own authorization rules; protect operate credentials accordingly.
{% endhint %}

## Prerequisites

- **A confirmed deployment whose flow starts with a deposit trigger.** Build and deploy a flow such
  as `Receive XLM → Swap → Pay USDC` or `Receive USDC → Split` in the builder; its status must be `CONFIRMED`. Its id is in the deployment page URL
  (`/deployments/<id>`), where the **API access** panel also lives.
- **A deployment API token**, or a Read and operate developer token explicitly selecting this deployment (see the developer-token guide above).
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

## Selected-deployment developer tokens

On builds containing #1028, use one `pfd_` credential for multiple explicitly
selected existing owned deployments. Create it in the signed-in
`/account/developer` panel; `READ_ONLY` permits reads and `READ_OPERATE` adds supported
operations. Permissions, labels and expiry are immutable; selection is editable,
including an empty selection. Future deployments never inherit access. Both `pfd_`
and existing `pfk_` support `GET /api/v1/deployments` discovery, with ID-bound UUID
pagination (default 20, max 100) and `{data:{items:[{id,flowName,network}],nextCursor}}`.

The [lifecycle and management reference](developer-tokens.md) covers owner-session
APIs, one-time reveal, 10 active credentials/100 grants, expiry, replacement and
revocation. The [permission matrix](developer-token-permissions.md) classifies every
operation. Per-endpoint rate allowances are shared across selected deployments,
including known live credential permission/grant refusals. A valid scoped READ_ONLY
credential gets 403 for operations; missing grants get generic 401. Wallet consent
and webhook secrets remain separate. READ_OPERATE can authorize supported relayer
early release; protect it accordingly.

Grant removal or revocation stops subsequent requests; submitted transactions and
settlement/finality evidence remain. Recover the original hash using a still-authorized
same-deployment credential or owner workflow. No automatic financial retries or
programmatic flow/deployment creation are added. Verify hosted rollout separately;
source OpenAPI revision 1.1.0 and local SDK support alone do not prove availability.

## Deployment API tokens

A `pfk_` token is bound to **one deployment**. Its supported operations depend on that deployment:
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
`execute`, `events`, `balances`, `funding`, `transactions`, `releaseEarly`, `payouts`,
`webhook`, `subscriptionAllowance`, `subscriptionState`, `subscriptionCancel`,
`subscriptionReactivate`, `swapQuote`, `scheduleState` and `scheduleControls`.
Each has a `status`, `authentication`, `requirements` and `nodeIds`:

- **`supported`**: the integration path exists for the recorded deployment. This does not promise
  the next transaction will succeed; balances, deadlines, trustlines and simulation still apply.
- **`conditional`**: a candidate path exists, but its own state/preparation endpoint must establish
  eligibility. Subscription approval must verify subscription classification, the configured
  subscriber and active state.
- **`unsupported`**: no matching path can be established from the recorded deployment metadata.

Standard On Receive flows support `execute` with configured recipients. The `payouts` capability key
remains in discovery responses but reports `unsupported` while Dev mode is disabled; no payout route
is published for this event.
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
Sign and submit before `expiresAt`, which is about three minutes after preparing.
After expiry, do not sign the stale envelope. Before preparing a replacement,
establish the original transaction outcome: the wallet may already have broadcast
it. Elapsed time, `UNKNOWN`, `NOT_FOUND`, missing history or absent events do not
prove failure or safe replacement. Retain the original preparation/hash and any
signed envelope privately, and use [transaction recovery](#recover-a-pending-transaction)
or platform support when the outcome remains uncertain.

{% hint style="warning" %}
`expiresAt` is about three minutes out, so stage the signing step before you call prepare: have the
`stellar tx sign` command ready to paste into, or have your local signer ready. If the
envelope expires, retain its recovery record and establish its outcome before
preparing another payment. Expiry does not cancel a transaction already broadcast.
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
| `CONFLICT`           | 409  | Already 10 active tokens, or another operation holds a conflicting state                                                                          |
| `VALIDATION`         | 422  | Bad body or query; a deposit the simulation rejects; a flow that doesn't start with a deposit trigger; an envelope that isn't this flow's deposit |
| `RATE_LIMITED`       | 429  | Too many requests in the window (see below); on the demo token, also when the instance has no shared rate limiter                                 |
| `INTERNAL`           | 500  | Unexpected server error; on the demo token, also a deliberate refusal when the demo flow is misconfigured, with the reason logged                 |
| `UPSTREAM_RPC`       | 502  | The Stellar RPC call failed, or the network was too busy to accept the transaction; retry, resubmitting the same envelope                         |

Every response carries an `x-request-id` header. Include it when you report a problem.

Wrapped deployment API responses also include `x-history-request-id`, a server-generated
analytics request UUID. Save it with the prepared envelope; send it as
`x-preparation-request-id` on `/execute/submit`, including retries.
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
if the committed copy falls behind, if a published route under `app/api/v1` has no entry, if an
example stops matching its Zod schema, or if the Postman collection misses a published v1 request.

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

### Subscription cancellation and reactivation (#913)

The deployment token opens the integration API; the currently configured subscriber's
wallet supplies consent. Read `subscription/state` and check `subscriptionCancel` or
`subscriptionReactivate` in capabilities first. These operations are conditional on
live state and successful simulation. Ordinary subscriptions are supported by the
implementation. Existing Dev cancellation continues with `FEATURE_DEV_MODE_ENABLED=false`;
Dev reactivation requires the feature enabled. New Dev deployments remain disabled for the
hackathon. Payroll, unsupported variants and ambiguous snapshots are refused.
Bounded hosted testnet cancellation/reactivation and zero-allowance checks passed;
see the [verification summary](#hosted-testnet-verification) for dated evidence,
the later fee-blocked charge test and target-environment limits.

Both actions expose three POST routes below `/api/v1/deployments/{id}`:

| Route suffix                                                           | Body                                | Limit per token |
| ---------------------------------------------------------------------- | ----------------------------------- | --------------- |
| `subscription/cancel/prepare` or `subscription/reactivate/prepare`     | `{"walletAddress":"G…"}`            | 10/minute       |
| `subscription/cancel/submit` or `subscription/reactivate/submit`       | `{"intent":"UUID","signedXdr":"…"}` | 30/minute       |
| `subscription/cancel/reconcile` or `subscription/reactivate/reconcile` | `{"intent":"UUID"}`                 | 30/minute       |

Cancellation requires an active subscription, calls `unsubscribe` and revokes that
subscription's token allowance. Reactivation requires cancelled state and calls
`subscribe`; it grants no allowance, creates no subscriber and does not immediately
charge or change billing. Use the existing public allowance approval workflow separately
before later scheduled charges can resume.

A complete browser/backend integration keeps the bearer token on its server and the
subscriber's private key in their wallet. Your authenticated application server proxies
only this deployment's action routes. Browser pseudocode with your wallet adapter:

```js
const action = "cancel"; // Use "reactivate" only after observing cancelled state.
const walletAddress = await wallet.getAddress();
const base = `/your-backend/subscription/${action}`;
const preparedResponse = await fetch(`${base}/prepare`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ walletAddress }),
});
const preparedBody = await preparedResponse.json();
if (!preparedResponse.ok) throw new Error(preparedBody.error.message);
const p = preparedBody.data;
// Save p.intent and p.txHash before signing; reconcile these after interruptions.
const signedXdr = await wallet.signTransaction(p.xdr, {
  networkPassphrase: p.networkPassphrase,
});
const submission = await fetch(`${base}/submit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ intent: p.intent, signedXdr }),
});
// After any response or transport interruption, poll the same p.txHash through
// GET /api/v1/deployments/{id}/transactions/{txHash} on your authenticated backend.
// Never interpret UNKNOWN, REJECTED, a 404 or a timeout as permission to replace.
```

Your server forwards these bodies unchanged and adds `Authorization: Bearer pfk_…`.
Preparation returns `{data:{intent,txHash,expiresAt,xdr,network,networkPassphrase,action,
walletAddress,nodeId,contractAddress,tokenContractAddress}}`. Only envelope signatures
may be added; source, sequence, fee, bounds, operation and authorization must stay exact.
Submission returns the existing `{data:{txHash,network,status,...}}` transaction status.
It records the admitted hash before broadcasting; exact signed retries use the same
intent and status. Changed envelopes and wrong-wallet signatures are refused.

To recover a lost response, an externally submitted envelope or an abandoned preparation,
POST the saved intent to the corresponding `reconcile` route. It returns
`{data:{intent,txHash,action,state,ledger,replacementAllowed}}`. `PREPARED` and `SUBMITTING`
retain the reservation; `SUCCESS`, `FAILED` and ledger-proven `EXPIRED` permit a new
preparation subject to current eligibility. RPC history gaps, queue refusal and local
clock expiry retain the reservation. A successful cancellation can therefore be reconciled
without satisfying the now-false "active" precondition again. Retired services do not reopen
API access for recovery; internal retirement reconciliation retains unresolved evidence.
See [wallet-control finality protocol](wallet-controls.md) for the exact recovery rules.

After `SUCCESS`, read state again and verify actual cancellation or reactivation. An empty
event feed alone proves nothing. Rehearse cancel → finality → cancelled state/zero allowance →
reactivate → finality → active state → separate allowance approval using a real consenting
testnet wallet before advertising availability.

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

### Deployment funding (#916)

Schedule top-ups and Webhook pool deposits use deployment-token GET/POST `/api/v1/deployments/{id}/funding`, `/funding/submit` and `/funding/reconcile`. Any consenting funding wallet may sign; a token alone cannot move funds. Funding adds funds only and does not execute payouts or callbacks. One unresolved intent per node blocks replacements until confirmed finality or ledger-proven expiry; UNKNOWN never permits another deposit. Public `/trigger`, `/submit-trigger` and hosted funding remain available. Webhook callbacks separately require `x-webhook-secret`. See the [complete signing and recovery example](funding.md). Bounded Schedule/Webhook funding passed on hosted testing/testnet; see the [verification summary](#hosted-testnet-verification) for evidence and remaining payout/environment limits.

### Schedule state and controller wallet actions

`GET /api/v1/deployments/{id}/schedule/state` reads current controller, pause/retrieval
permissions, token holdings and vested payout availability. Select `nodeId` when
multiple Schedule nodes exist. `POST /schedule/pause`, `/schedule/resume` and
`/schedule/retrieve` prepare an unsigned transaction; their `/submit` routes require
the unchanged controller-wallet-signed envelope and intent. Each `/reconcile` route
recovers the corresponding intent using durable finality evidence. Retrieval returns
only permitted unvested funds to the deployed controller; it never pays recipients.
See [Schedule controls](schedule-controls.md) for complete wallet/recovery examples,
amount semantics, completed testing/testnet checks and remaining payout/environment limits. Discovery exposes
`scheduleState` and conditional `scheduleControls`; a token alone does not authorize
controls. Funding remains a separate operation.

## Custom browser and server integration

This independent Next.js example shows a fixed-price checkout without the starter.
For the end-to-end wallet, flow and SDK app-integration walkthrough, use the
[Paiflow Guide](../hackathon/paiflow-guide.md). For a typed Node backend, use the
[SDK README](../../packages/sdk/README.md); the SDK remains server-side and your
browser wallet still signs the unchanged preparation.

The HTTP example below is a teaching example, not a production checkout. It keeps
retry state only in tab memory; the starter has persisted recovery. Add your own
authentication, order checks and durable recovery before using this pattern in a real app.
Do not copy these replacement routes into the starter.

### 1 Prepare a deployment and app

Use a standard flow with recipients and required values configured before deployment. Follow your event primer for preparation permissions and feature availability; this example uses neither flow Dev mode nor per-payment recipients.

Build and deploy a standard **On Receive XLM → percentage Split XLM** flow: 90% to a shop and 10% to a community fund. Keep **Dev mode off** for this example and use two distinct funded Testnet recipient addresses. Wait for **CONFIRMED**, then copy its deployment UUID. Create a single-deployment token in **API access**, or a developer token with **Read and operate** that explicitly selects this deployment.

Use a full/team Paiflow account at [beta.app.paiflow.xyz](https://beta.app.paiflow.xyz). Sandbox accounts cannot create tokens or use their deployments through the partner API. API access requires an **ACTIVE** deployment and active owner; retiring/retired deployments and revoked/expired tokens are refused.

The example charges **1 XLM**, so expect **0.9 XLM and 0.1 XLM** in payouts. The customer needs Testnet XLM for the payment and fees. One deployment serves all customers with the same configured rules.

This example uses a **Next.js App Router app with JavaScript**. The same server/browser boundary applies to other stacks.

#### Install development tools

For this JavaScript example, use **Node.js 22 and pnpm 10.4.1**, matching the supplied starter's tools. On the [Node.js download page](https://nodejs.org/en/download), select **22.x**, install it and reopen your terminal. On macOS/Linux, you can instead install [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), then run `nvm install 22` and `nvm use 22`. Install pnpm with npm, which comes with Node.js:

```bash
node --version
npm install --global pnpm@10.4.1
pnpm --version
```

Check that Node starts with `v22.` and pnpm prints `10.4.1`. Downloads need an internet connection. If both tools already match, skip installation. These tools run this example app; Paiflow's API can also be used from other languages and frameworks.

#### Create an app and install integration packages

**Starting a new app:** run the app generator:

```bash
pnpm create next-app@latest paiflow-api-example
```

When asked whether to use the recommended defaults, choose **No, customize settings**. Select:

- **TypeScript:** No, so the app uses JavaScript and `app/page.js`.
- **React Compiler:** No for this example.
- **`src/` directory:** No, so `app/` is at the project root.
- **App Router:** Yes.
- **Cache Components:** No for this example, if prompted.

Keep the other settings at their defaults. Then enter the new project folder and install the two integration packages:

```bash
cd paiflow-api-example
pnpm add @stellar/freighter-api server-only
```

**Using an existing Next.js app:** open a terminal in its project folder and run `pnpm add @stellar/freighter-api server-only`. Skip creating a new project. If your app uses a `src/` directory, put the example files under `src/app/` instead of `app/`.

The packages have separate roles: `@stellar/freighter-api` connects to the browser wallet and requests signatures; `server-only` prevents the backend module from being imported into browser code.

In section 2, create `app/api/payment/route.js` using the server-route code. In section 3, replace the contents of `app/page.js` with the checkout-page code. Keep the existing `app/layout.js` file; it provides the page's required layout.

Create or edit `.env.local` in your project root. Set these server-only values, replace both placeholders with your deployment UUID and token, and restart the dev server if it is running:

```dotenv
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_DEPLOYMENT_ID=YOUR_CONFIRMED_DEPLOYMENT_UUID
PAIFLOW_API_TOKEN=YOUR_AUTHORISED_API_TOKEN
```

Never prefix the token with `NEXT_PUBLIC_`, send it to the browser or commit `.env.local`. This independent example has no starter mode setting; follow your event primer for when integration and test payments are permitted. No wallet secret keys belong in your app.

### 2 Add the server route

Create `app/api/payment/route.js`. It exposes only preparation, submission, transaction lookup and payment events for your configured deployment. The browser supplies a public customer address; the server sets the price. Clients cannot choose an upstream URL, deployment or payment amount.

```javascript
import "server-only";

async function upstream(path, options = {}, preparationRequestId = null) {
  const origin = new URL(process.env.PAIFLOW_BASE_URL);
  const id = process.env.PAIFLOW_DEPLOYMENT_ID;
  const token = process.env.PAIFLOW_API_TOKEN;
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || "") ||
    !/^(?:pfk|pfd)_[a-f0-9]{64}$/.test(token || "")
  ) {
    throw new Error("Invalid server configuration");
  }
  const response = await fetch(new URL(`/api/v1/deployments/${id}/${path}`, origin), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(preparationRequestId ? { "x-preparation-request-id": preparationRequestId } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(35000),
  });
  const headers = { "Cache-Control": "no-store" };
  for (const name of ["Retry-After", "x-request-id", "x-history-request-id"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return Response.json(await response.json(), {
    status: response.status,
    headers,
  });
}

function invalid() {
  return Response.json(
    { error: { code: "VALIDATION", message: "Invalid payment request" } },
    { status: 422 },
  );
}

function unavailable() {
  return Response.json(
    {
      error: {
        code: "UNAVAILABLE",
        message: "Request uncertain. Check the original payment before trying a new one.",
      },
    },
    { status: 502 },
  );
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
    if (
      body.action === "prepare" &&
      Object.keys(body).length === 2 &&
      typeof body.from === "string" &&
      /^G[A-Z2-7]{55}$/.test(body.from)
    ) {
      return await upstream("execute", {
        method: "POST",
        body: JSON.stringify({ from: body.from, amount: "10000000" }),
      });
    }
    if (
      body.action === "submit" &&
      Object.keys(body).every((key) =>
        ["action", "signedXdr", "preparationRequestId"].includes(key),
      ) &&
      (body.preparationRequestId == null ||
        (typeof body.preparationRequestId === "string" &&
          /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.preparationRequestId))) &&
      typeof body.signedXdr === "string" &&
      body.signedXdr.length >= 10 &&
      body.signedXdr.length <= 200000
    ) {
      return await upstream(
        "execute/submit",
        {
          method: "POST",
          body: JSON.stringify({ signedXdr: body.signedXdr }),
        },
        body.preparationRequestId,
      );
    }
    return invalid();
  } catch {
    return unavailable();
  }
}

export async function GET(request) {
  try {
    const query = new URL(request.url).searchParams;
    const hash = query.get("txHash") || "";
    if (!/^[a-f0-9]{64}$/i.test(hash)) return invalid();
    if (query.get("kind") === "status") {
      return await upstream(`transactions/${hash}`);
    }
    if (query.get("kind") === "events") {
      return await upstream(`events?txHash=${hash}&limit=100`);
    }
    return invalid();
  } catch {
    return unavailable();
  }
}
```

The API validates the address checksum and transaction contents; the local route also restricts the accepted shape. `amount` is an integer string in the input asset's smallest units: **1 XLM = `"10000000"`**. For a real checkout, calculate the price from your server's order data with exact arithmetic, rather than trusting a browser-supplied total.

The route forwards `x-history-request-id` from preparation. The browser keeps that non-secret ID with the signed envelope and sends it back on every submit/retry; the route forwards it as `x-preparation-request-id`. It is analytics metadata, not wallet authorization. A new preparation gets a new ID. Older deployments without the header still work, but those submissions remain unlinked in analytics.

### 3 Connect Freighter, sign and submit

Replace `app/page.js` with this browser page. Install/unlock the [Freighter extension](https://www.freighter.app/), select Testnet and use a funded customer account. The payment button requests access to your local app; access granted to Paiflow is separate.

```jsx
"use client";

import { useRef, useState } from "react";
import {
  requestAccess,
  getAddress,
  getNetworkDetails,
  signTransaction,
} from "@stellar/freighter-api";

const TESTNET = "Test SDF Network ; September 2015";

async function api(url, body) {
  const response = await fetch(url, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    const error = new Error(result.error?.message || `HTTP ${response.status}`);
    error.retryAfter = response.headers.get("Retry-After");
    error.requestId = response.headers.get("x-request-id");
    throw error;
  }
  if (body?.action === "prepare") {
    return { ...result.data, preparationRequestId: response.headers.get("x-history-request-id") };
  }
  return result.data;
}

export default function Checkout() {
  const envelope = useRef(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState(null);
  const [message, setMessage] = useState("");

  async function run(action) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(
        [
          error.message,
          error.retryAfter && `Wait ${error.retryAfter} before retrying.`,
          error.requestId && `Request ID: ${error.requestId}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    const data = await api("/api/payment", {
      action: "submit",
      ...envelope.current,
    });
    setResult(data);
    if (data.status === "SUCCESS" || data.status === "FAILED") {
      envelope.current = null;
      setUncertain(false);
    }
  }

  async function pay() {
    if (envelope.current) throw new Error("Check the existing payment first.");
    const access = await requestAccess();
    if (access.error || !access.address) throw new Error("Allow Freighter access.");
    const from = access.address;
    const network = await getNetworkDetails();
    if (network.error || network.networkPassphrase !== TESTNET) {
      throw new Error("Switch Freighter to Testnet.");
    }
    setResult(null);
    setEvents(null);
    const prepared = await api("/api/payment", { action: "prepare", from });
    const expiry = Date.parse(prepared.expiresAt);
    if (
      prepared.network !== "testnet" ||
      prepared.networkPassphrase !== TESTNET ||
      !Number.isFinite(expiry) ||
      Date.now() >= expiry
    ) {
      throw new Error("Check the preparation network and expiry.");
    }
    const current = await getAddress();
    if (current.error || current.address !== from) throw new Error("Wallet changed. Start again.");
    const signed = await signTransaction(prepared.xdr, {
      networkPassphrase: TESTNET,
      address: from,
    });
    if (signed.error || !signed.signedTxXdr || signed.signerAddress !== from) {
      throw new Error("Payment was not signed by the expected customer.");
    }
    envelope.current = {
      signedXdr: signed.signedTxXdr,
      preparationRequestId: prepared.preparationRequestId,
    };
    setUncertain(true); // Save before submit, including timeout/error cases.
    await submit();
  }

  async function inspect(kind) {
    const data = await api(`/api/payment?kind=${kind}&txHash=${result.txHash}`);
    if (kind === "events") {
      setEvents(data);
    } else {
      setResult(data);
      if (data.status === "SUCCESS" || data.status === "FAILED") {
        envelope.current = null;
        setUncertain(false);
      }
    }
  }

  return (
    <main>
      <h1>Testnet checkout: 1 XLM</h1>
      <p>
        Expected payout: 0.9 XLM to the shop and 0.1 XLM to the community fund. Fees are additional.
      </p>
      <button disabled={busy || uncertain} onClick={() => run(pay)}>
        Pay 1 XLM
      </button>
      <button disabled={busy || !uncertain} onClick={() => run(submit)}>
        Check again
      </button>
      <button disabled={busy || !result?.txHash} onClick={() => run(() => inspect("status"))}>
        Look up status
      </button>
      <button disabled={busy || !result?.txHash} onClick={() => run(() => inspect("events"))}>
        Read payout events
      </button>
      {busy && <p>Waiting for the wallet or network…</p>}
      {message && <p role="alert">{message}</p>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      {events && <pre>{JSON.stringify(events, null, 2)}</pre>}
    </main>
  );
}
```

Run `pnpm dev` and open `http://localhost:3000`. Review the asset, amount, network and account in Freighter before confirming. Preparation lasts approximately **180 seconds**; have the wallet ready. Signing stays inside Freighter; the bearer token stays on your server. The browser receives only unsigned preparation data and payment results.

### 4 Verify the payment and payouts

Select **Pay 1 XLM**, sign in Freighter, and inspect the returned `status` and `txHash`. HTTP 200 alone is not payment confirmation.

| Result                                 | What to do                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SUCCESS`                              | Payment confirmed. Select Read payout events and verify the expected two recipients and amounts.                         |
| `FAILED`                               | Submission rejected or transaction failed. Read the error and check transaction status before preparing another payment. |
| `PENDING` or an uncertain submit error | Keep the tab open. Check again submits the same signed envelope; it does not create a second payment.                    |

**Look up status** checks `GET /api/v1/deployments/{id}/transactions/{txHash}` without resubmitting. It may also return `REJECTED` (submission refusal, not on-chain failure) or `UNKNOWN` (insufficient evidence). Neither `UNKNOWN`, a `404`, nor a timeout proves failure or authorises a replacement payment. Keep checking the original transaction; create a replacement only after confirmed failure or verified expiry without inclusion on-chain.

**Read payout events** calls `GET /api/v1/deployments/{id}/events?txHash=…&limit=100`. Check `items`, `nextCursor` and `hasMore`. For this two-recipient example, verify **0.9 XLM to the shop and 0.1 XLM to the community fund**, using the event data and the transaction on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet). A percentage Split event can describe shares rather than literal transfer amounts; use transaction evidence to verify the actual transfers.

A delayed feed is not proof of failure. This example reads one event page on demand. For continuous feeds, follow `nextCursor` while `hasMore` is true, deduplicate by `eventId`, associate activity by `txHash`, and back off between polls. The [API reference](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md) explains event shapes and pagination.

### 5 Adapt it to your app

Keep the payment sequence intact while replacing the fixed price and UI with your idea. Use server-side order totals and exact integer amounts. Your deployment sets its shared recipients and rules; the API executes that deployment, rather than creating a flow for every customer.

The example preserves signed envelopes only in tab memory. Reloading loses that retry state. Before starting another payment after a reload, investigate the original transaction through your wallet/explorer and platform support. Elapsed `expiresAt`, a missing saved signature, `UNKNOWN`, `NOT_FOUND` or absent events do not establish that replacement is safe. The execute API cannot prove safe replacement from expiry or missing history alone. A real app needs a durable payment record with its transaction hash, clear pending states, and its own authentication and order-to-transaction checks. Avoid logging signed envelopes or credentials.

Changing settings or closing the page does not cancel a submitted transaction. A token authenticates your backend to Paiflow; it does not replace customer signing or your app's own authorisation. This sample does not implement subscriptions, schedules, webhooks, early release or a continuous feed.

For other flow types, first inspect `GET /api/v1/deployments/{id}/capabilities` with the same bearer token. Supported paths still require live checks for balances, consent and configuration. Use the reference for those integrations instead of treating them as ordinary On Receive payments.

For advanced flows, discover capabilities first and use the corresponding reference:
[balances](#deployment-contract-balances), [Swap estimates](#deployment-specific-swap-estimates),
[funding](funding.md), [Schedule controls](schedule-controls.md),
[Subscription wallet controls](wallet-controls.md), and
[webhook retry safety](#retry-webhook-rewards-safely).
These paths have distinct wallet consent and recovery requirements; they are not ordinary Execute payments.
See [hosted verification](#hosted-testnet-verification) for dated evidence and fee-blocked tests.

When requesting support, include the deployment UUID, transaction hash, error
message and request ID when available. Keep tokens, wallet secrets and signed
envelopes out of support messages.
