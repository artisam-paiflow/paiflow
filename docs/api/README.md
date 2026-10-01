# Developer API

Paiflow's `/api/v1` lets your backend run a deployed **deposit-triggered flow** (Pay, Split, condition or swap) and watch what it did on
chain, with no browser and no wallet integration on Paiflow's side. You send the deposit, the flow
runs (paying, splitting, routing or swapping on a real DEX) and you poll the events.

| Artefact                  | Where                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI 3.1 specification | Served at [`https://paiflow.xyz/api/v1/openapi.json`](https://paiflow.xyz/api/v1/openapi.json); source [`docs/api/openapi.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/openapi.json)                                                                                     |
| Postman collection        | [`paiflow-api-v1.postman_collection.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json) (import by link: [raw file](https://raw.githubusercontent.com/artisam-paiflow/paiflow/develop/docs/api/paiflow-api-v1.postman_collection.json)) |
| This guide                | [paiflow.gitbook.io/paiflow-docs/reference/api](https://paiflow.gitbook.io/paiflow-docs/reference/api); source `docs/api/README.md`                                                                                                                                                                 |

{% hint style="warning" %}
**Testnet only.** The public instance at `https://paiflow.xyz` runs on Stellar testnet. Every
account, asset and amount in this guide is a testnet one.
{% endhint %}

`https://paiflow.xyz` is the canonical host, and it is the only entry in the OpenAPI `servers`
list. `https://beta.app.paiflow.xyz` is the same service with the same database, so every request
in this guide works against either host.

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
**The API never signs.** Paiflow is non-custodial: your secret key never leaves your side and is
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
curl -X POST https://paiflow.xyz/api/v1/demo-token
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

A token is bound to **one deployment**. It can prepare and submit that deployment's execution and
read its events, and nothing else: no other deployment, no account data, no admin routes.

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
export PAIFLOW=https://paiflow.xyz
export DEPLOYMENT_ID=<deployment id>
export PAIFLOW_TOKEN=pfk_<64 hex>
export FROM=G...                  # the funded account that deposits and signs
export FROM_SECRET=S...           # its secret key; stays on your machine
```

### 1. Prepare

`amount` is in **stroops** of the flow's input asset, as a string: 1 XLM = `10000000`.

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":\"10000000\",\"from\":\"$FROM\"}" | tee prepared.json
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

const prepared = await fetch(`${base}/execute`, {
  method: "POST",
  headers,
  body: JSON.stringify({ amount: "10000000", from: process.env.FROM }),
}).then((r) => r.json());

const tx = TransactionBuilder.fromXDR(prepared.data.xdr, prepared.data.networkPassphrase);
tx.sign(Keypair.fromSecret(process.env.FROM_SECRET!));

const submitted = await fetch(`${base}/execute/submit`, {
  method: "POST",
  headers,
  body: JSON.stringify({ signedXdr: tx.toXDR() }),
}).then((r) => r.json());
```

Always sign with the `networkPassphrase` the response gives you. An envelope signed for a different
network is rejected.

### 3. Submit

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit" \
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
| `CONFLICT`           | 409  | Token management only: already 10 active tokens                                                                                                   |
| `VALIDATION`         | 422  | Bad body or query; a deposit the simulation rejects; a flow that doesn't start with a deposit trigger; an envelope that isn't this flow's deposit |
| `RATE_LIMITED`       | 429  | Too many requests in the window (see below); on the demo token, also when the instance has no shared rate limiter                                 |
| `INTERNAL`           | 500  | Unexpected server error; on the demo token, also a deliberate refusal when the demo flow is misconfigured, with the reason logged                 |
| `UPSTREAM_RPC`       | 502  | The Stellar RPC call failed, or the network was too busy to accept the transaction; retry, resubmitting the same envelope                         |

Every response carries an `x-request-id` header. Include it when you report a problem.

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
| `GET /api/v1/openapi.json`                    | 60 per minute per client IP (no token)                    |
| `POST /api/v1/demo-token`                     | 3 per hour per client IP, 60 per hour instance-wide       |
| Token management (owner session, not the API) | 20 per minute per signed-in user, across all three routes |

## Postman

Import [`paiflow-api-v1.postman_collection.json`](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json)
(in Postman, **Import → Link** and paste the
[raw file URL](https://raw.githubusercontent.com/artisam-paiflow/paiflow/develop/docs/api/paiflow-api-v1.postman_collection.json)), then:

1. Fill in the collection variables `deploymentId`, `apiToken` and `from`, and adjust `amount`.
   `baseUrl` is already `https://paiflow.xyz`.
2. Run **Prepare execute**. It stores the envelope in the `unsignedXdr` variable.
3. Sign it on your side (`stellar tx sign --sign-with-key S… --network testnet "<unsignedXdr>"`) and
   paste the result into `signedXdr`.
4. Run **Submit execute**. It stores `txHash`.
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
eval $(curl -sX POST https://paiflow.xyz/api/v1/demo-token |
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
- this guide and the [OpenAPI document](https://paiflow.xyz/api/v1/openapi.json).

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
