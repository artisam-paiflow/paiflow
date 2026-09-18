# Developer API

Paiflow's `/api/v1` lets your backend run a deployed **swapper flow** and watch what it did on
chain, with no browser and no wallet integration on Paiflow's side. You send the deposit, the flow
swaps it on a real DEX and pays the proceeds out, and you poll the events.

| Artefact                  | Where                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| OpenAPI 3.1 specification | [`openapi.json`](openapi.json), also served at `GET https://paiflow.xyz/api/v1/openapi.json` |
| Postman collection        | [`paiflow-api-v1.postman_collection.json`](paiflow-api-v1.postman_collection.json)           |
| This guide                | `docs/api/README.md`                                                                         |

{% hint style="warning" %}
**Testnet only.** The public instance at `https://paiflow.xyz` runs on Stellar testnet. Every
account, asset and amount in this guide is a testnet one.
{% endhint %}

## How it works

A swapper flow starts at its **deposit trigger**: a contract that receives `deposit(from, amount)`
and passes the funds down the pipeline, where the swapper exchanges them and the payer forwards the
proceeds. The swapper can't be called directly (it only accepts calls from the step before it), so
"executing a swapper flow" means depositing into its trigger.

The deposit has to be authorized by the account the funds come from. That's you, so executing a
flow takes three steps:

1. **Prepare.** `POST /api/v1/deployments/{id}/execute` builds and simulates the deposit and returns
   an **unsigned** transaction envelope.
2. **Sign.** You sign that envelope with the `from` account's key, on your side.
3. **Submit.** `POST /api/v1/deployments/{id}/execute/submit` checks the envelope, sends it to the
   network, waits for the result and records it.

Then `GET /api/v1/deployments/{id}/events` returns the deposit, swap and payout events.

{% hint style="info" %}
**The API never signs.** Paiflow is non-custodial: your secret key never leaves your side and is
never sent to Paiflow. The sign step is always yours, and curl alone can't do it, which is why the
examples below use `stellar tx sign` or the Stellar SDK between the two calls. It also limits what a
leaked API token can do: prepare an envelope, and relay one that your key already signed. It can't
move funds on its own.
{% endhint %}

## Prerequisites

- **A confirmed swapper deployment.** Build and deploy a flow such as `Receive XLM → Swap → Pay
USDC` in the builder; its status must be `CONFIRMED`. Its id is in the deployment page URL
  (`/deployments/<id>`), where the **API access** panel also lives.
- **A deployment API token**, minted by the deployment's owner (see below).
- **A funded Stellar account** to deposit from. It pays the deposit and the transaction fee, and
  signs the envelope. On testnet, fund one with friendbot:
  `curl "https://friendbot.stellar.org?addr=G…"`. Depositing XLM needs nothing more; depositing
  another asset needs a trustline and a balance for it.
- **A trustline on the payout recipient** for the asset the flow pays out (for example USDC). A
  missing trustline makes the whole pipeline revert.

## Deployment API tokens

A token is bound to **one deployment**. It can prepare and submit that deployment's execution and
read its events, and nothing else: no other deployment, no account data, no admin routes.

- **Minting.** The deployment's owner signs in, opens the deployment page and uses the **API access**
  panel. Tokens can only be minted for a `CONFIRMED` deployment, and a deployment can have at most 10
  active tokens.
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
  `?wait=false` to get `PENDING` back as soon as the network accepts the transaction.
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
- **It's audited.** Every prepare, submit and confirmation is written to the deployment owner's
  audit log, with the token id.

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
- **Up to about a minute behind.** Events are collected by a poller that runs every minute. A
  `SUCCESS` from `execute/submit` also records that transaction's events immediately, so
  `?txHash=<txHash>` right after a submit usually already has them.
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

| `code`               | HTTP | When                                                                                                                              |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`    | 401  | Token missing, unknown, revoked, expired, or for another deployment (token management: no signed-in session)                      |
| `INSUFFICIENT_FUNDS` | 402  | The `from` account doesn't exist on this network (prepare)                                                                        |
| `FORBIDDEN`          | 403  | Not allowed for this caller (sandbox)                                                                                             |
| `NOT_FOUND`          | 404  | A malformed deployment id, or (execute) a deployment that isn't confirmed                                                         |
| `CONFLICT`           | 409  | Token management only: already 10 active tokens                                                                                   |
| `VALIDATION`         | 422  | Bad body or query; a deposit the simulation rejects; a flow that isn't a swapper flow; an envelope that isn't this flow's deposit |
| `RATE_LIMITED`       | 429  | Too many requests in the window (see below)                                                                                       |
| `INTERNAL`           | 500  | Unexpected server error                                                                                                           |
| `UPSTREAM_RPC`       | 502  | The Stellar RPC call failed, or the network was too busy to accept the transaction; retry, resubmitting the same envelope         |

Every response carries an `x-request-id` header. Include it when you report a problem.

## Rate limits

Limits are counted **per token**, per endpoint, in fixed 60-second windows. Going over returns
`429 RATE_LIMITED`.

| Endpoint                                      | Limit                                                     |
| --------------------------------------------- | --------------------------------------------------------- |
| `POST …/execute`                              | 30 per minute                                             |
| `POST …/execute/submit`                       | 30 per minute                                             |
| `GET …/events`                                | 120 per minute                                            |
| `GET /api/v1/openapi.json`                    | 60 per minute per client IP (no token)                    |
| Token management (owner session, not the API) | 20 per minute per signed-in user, across all three routes |

## Postman

Import [`paiflow-api-v1.postman_collection.json`](paiflow-api-v1.postman_collection.json), then:

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

`GET https://paiflow.xyz/api/v1/openapi.json` is public, so anyone can fetch the specification
without an account. Every other `/api/v1` endpoint needs a deployment token. A token can only be
minted by a signed-in owner of a confirmed deployment, and the anonymous sandbox identity on the
login page can't mint one. So a reviewer without an owner account can **read** the API path rather
than drive it:

- the curl transcript, audit log rows and transaction link in
  [`docs/instawards/evidence/d2/`](../instawards/evidence/d2/README.md);
- the [Postman collection](paiflow-api-v1.postman_collection.json) and its saved responses;
- this guide and the [OpenAPI document](openapi.json).

An owner account on paiflow.xyz can be provisioned on request, to run the full sequence.

## Keeping the spec in sync

The OpenAPI document is a TypeScript object in `lib/api/v1/openapi.ts`. After changing it, run
`pnpm api:openapi` to regenerate `docs/api/openapi.json`. `tests/unit/api/v1/openapi.test.ts` fails
if the committed copy falls behind, if a route under `app/api/v1` has no entry, if an example stops
matching its Zod schema, or if the Postman collection misses a v1 request.
