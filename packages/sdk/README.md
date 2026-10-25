# @paiflow/sdk

Node SDK beta for existing Paiflow deployments: typed reads, payments, funding,
Schedule and Subscription controls, public allowance consent, Webhook callbacks,
early release and embed SSE. It does not create or deploy flows.

## Install and make your first request

SDK **0.2.0 is published** under the npm `beta` tag. Pin the version below; the
`latest` tag may point to an older release. Requires Node `>=22.22.2 <23`.
Output is ESM with TypeScript declarations and no runtime dependencies. CommonJS
consumers can use dynamic import. TypeScript consumers use `NodeNext` module and
module-resolution settings.

```sh
npm install @paiflow/sdk@0.2.0
```

Save this as `first-read.mjs` in your Node application. Configure
`PAIFLOW_BASE_URL`, `PAIFLOW_API_TOKEN` and `PAIFLOW_DEPLOYMENT_ID` in your server's
environment, then run `node first-read.mjs`. The token must have access to that
confirmed, active deployment.

```js
import { Paiflow } from "@paiflow/sdk";

const { PAIFLOW_BASE_URL, PAIFLOW_API_TOKEN, PAIFLOW_DEPLOYMENT_ID } = process.env;
if (!PAIFLOW_BASE_URL || !PAIFLOW_API_TOKEN || !PAIFLOW_DEPLOYMENT_ID) {
  throw new Error("Configure the Paiflow server environment first");
}
const client = new Paiflow({ baseUrl: PAIFLOW_BASE_URL, token: PAIFLOW_API_TOKEN });
const deployment = client.deployment(PAIFLOW_DEPLOYMENT_ID);
const { data: capabilities, metadata } = await deployment.capabilities.get();
// Inspect capabilities.operations before offering a workflow to your users.
console.info({ network: capabilities.network, requestId: metadata.requestId });
```

Keep this client and its credential on your **Node server**. Your authenticated app
routes call it; a browser wallet separately signs the unchanged prepared envelope.
Never expose tokens through browser bundles, public environment variables, URLs or
logs. The SDK does not authenticate your app's users or enforce order ownership,
price, recipient rules or fulfilment; your application must do so.

Create a `pfd_` developer token in your Paiflow account's Developer API panel and
explicitly select your existing owned deployments. **Read only** permits discovery
and reads; **Read and operate** also permits preparation, submission, reconciliation
and relayer operations. Tokens provide API access, never wallet consent. Existing
`pfk_` tokens remain supported for their single bound deployment. See the
[developer-token guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/developer-tokens.md)
and [permission matrix](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/developer-token-permissions.md).
Developer credentials and discovery require API specification revision `1.1.0` or
a compatible later revision; verify the target environment's specification and
capabilities. SDK, app and API versions advance independently.

## Find the right reference

- [Generated method and type reference](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/reference/README.md): exported SDK classes, methods, parameters and return types.
- [Workflow examples and HTTP migration](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/quickstart.md).
- [Minimal SDK starter](https://github.com/artisam-paiflow/paiflow-hackathon-starter): runnable native-XLM testnet payment app.
- [Paiflow Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/paiflow-guide.md): wallet setup, flow deployment and app integration.
- [HTTP API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md): direct HTTP integration, OpenAPI and Postman.
- [Endpoint coverage matrix](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/contract.md#endpoint-matrix): all 43 covered HTTP operations, including explicitly supported unversioned routes.

GitHub links track the public `develop` documentation; the pinned npm version
above identifies the installed artifact. Runtime/types are shipped in that package.

## Configuration and response metadata

| `PaiflowOptions` field | Meaning                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`              | Required trusted HTTPS origin, without a path, credentials, query or fragment. HTTP is allowed only for loopback development.       |
| `token`                | Optional server-only `pfd_` or `pfk_` credential. Required for token-authenticated methods; omitted on public and webhook requests. |
| `fetch`                | Optional standards-compliant fetch implementation; must honour redirect refusal and omitted cookies.                                |
| `timeoutMs`            | Positive integer timeout, default 30,000 ms, covering fetch and body parsing.                                                       |

| Per-request option     | Meaning                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `signal`               | Caller cancellation via `AbortSignal`. Cancellation does not prove a submitted transaction failed.                                  |
| `timeoutMs`            | Override this request's timeout. Each pagination request has its own timeout.                                                       |
| `requestId`            | Optional 1–128-character identifier using letters, digits, `.`, `_`, `:`, `-`.                                                      |
| `preparationRequestId` | Original preparation's history UUID, forwarded during submission for correlation. Signing helpers return it in `submissionOptions`. |

Methods return `ApiResponse<T>` with parsed `data` and `metadata`. URL helpers
return strings; pagination and SSE methods yield responses through async generators.
Signing helpers return the preserved preparation and explicit submission arguments.

| Metadata field     | Meaning                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `status`           | HTTP status; HTTP success alone does not prove payment success.                                   |
| `requestId`        | Optional server request ID for diagnostics.                                                       |
| `historyRequestId` | Optional durable history UUID; persist preparation metadata before requesting a wallet signature. |
| `retryAfter`       | Optional raw Retry-After header; the SDK does not retry automatically.                            |

## Handle errors and uncertain outcomes

```ts
import {
  Paiflow,
  PaiflowApiError,
  PaiflowAbortError,
  PaiflowTimeoutError,
  PaiflowMalformedResponseError,
  PaiflowTransportError,
} from "@paiflow/sdk";

export async function readCapabilities(client: Paiflow, deploymentId: string) {
  try {
    return await client.deployment(deploymentId).capabilities.get();
  } catch (error: unknown) {
    if (error instanceof PaiflowApiError) {
      // error.fields/details are unknown: narrow before displaying specific fields.
      // Future API error codes remain strings; do not assume a closed enum.
      throw new Error(`Paiflow HTTP ${error.status}: ${error.code}`);
    }
    if (error instanceof PaiflowAbortError || error instanceof PaiflowTimeoutError) {
      throw new Error("Request interrupted; reconcile any existing payment before retrying");
    }
    if (error instanceof PaiflowMalformedResponseError) {
      throw new Error(`Invalid response (HTTP ${error.metadata.status})`);
    }
    if (error instanceof PaiflowTransportError) {
      throw new Error("Paiflow is unreachable; preserve any existing transaction");
    }
    throw error; // Includes TypeError for invalid caller input.
  }
}
```

`PaiflowSigningError` covers rejected or invalid signing results; signing may also
throw typed timeout/abort errors. The signing helper never submits. Do not log
credentials, signed XDR, authorization entries, opaque allowance intents or raw
errors. Preserve the original preparation, signed envelope and transaction hash
before submission. After uncertainty, query status or reconcile the original
intent; where appropriate, explicitly resubmit the **same** envelope. UNKNOWN,
REJECTED, missing history, elapsed time and local expiry never authorize a new
payment. There are no automatic retries, re-preparations or polling loops.

## Transport foundation

Configure a trusted HTTPS service origin, a server-side developer or deployment token when
needed, and optionally an injected standards-compliant fetch implementation.
HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]` development origins.
Base URLs cannot contain credentials, query strings or path prefixes. Requests
never follow redirects and use `credentials: "omit"`; public and webhook requests
never inherit the bearer token. An injected fetch must honor these options.

`request()` requires explicit public, token or webhook authentication and a
parser from `unknown` to the desired result. It unwraps `{data}` once, or accepts
an explicitly raw response, retaining HTTP status, request/history IDs and
Retry-After. API errors preserve safe structured fields/details and future error
codes; known sensitive keys and supplied credentials are redacted. Control-intent
UUIDs, transaction hashes and node identifiers remain available for recovery. Transport,
malformed-response, timeout and abort errors never include raw bodies or causes.

Requests default to a 30-second timeout covering fetching and body parsing.
Caller cancellation is supported. There are no retries, including for POST:
a timeout or abort after sending does not prove financial failure. Retain the
original transaction and use the workflow's status/reconciliation protocol.
HTTP success alone does not establish transaction success.

Paths must be canonical API paths. Query parameters cannot contain credentials;
the opaque `intent` parameter is permitted only for the documented public
subscription-allowance status protocol. Do not log that URL. Request options
allow validated caller request IDs and UUID preparation-history correlation IDs,
not arbitrary header overrides. Read methods validate published response fields and tolerate additive fields.
Unknown transaction statuses are malformed; UNKNOWN and REJECTED are preserved.

## Selected deployment discovery (0.2.0)

Use one developer token (`pfd_` plus 64 lowercase hex characters) in your Node
server to access explicitly selected existing deployments. Keep the credential out
of browser bundles, URLs and logs. Existing `pfk_` clients keep working, with their
single-deployment scope; legacy `pkdev_` credentials are rejected.

```ts
const client = new Paiflow({ baseUrl: serviceOrigin, token: developerToken });
for await (const page of client.deployments.pages({ limit: 20 }, { maxPages: 10, signal })) {
  for (const selected of page.data.items) {
    const events = await client.deployment(selected.id).events.list({}, { signal });
    // Process events.data; retain page.data.nextCursor for explicit continuation.
  }
}
```

`deployments.list(query?, options?)` returns one `ApiResponse<ListDeploymentsResponse>`:
`{items:[{id,flowName,network}],nextCursor}`. Query fields are optional UUID `cursor`
and integer `limit` (1–100, server default 20). `deployments.pages` follows ID-ordered
cursors until null or its page cap (default 100, configurable 1–10,000), rejecting
repeated, cyclic or backward cursors. A cap ends iteration with the last yielded
cursor available for continuation; it does not prove discovery is complete.
Each request has its own timeout and response metadata. Cancellation throws
`PaiflowAbortError`; no automatic retries occur.

Read only credentials can discover and read. Read and operate additionally permits
existing preparation, submission, reconciliation and relayer workflows, subject to
server enforcement and required wallet consent. Selection changes and revocation
apply to subsequent requests, so discovery does not guarantee later access.
Endpoint rate allowances are shared across the token's selected deployments.
Tokens do not create flows/deployments or authorize separate webhook secrets.

## Deployment reads and public utilities

```ts
import { Paiflow } from "@paiflow/sdk";

const client = new Paiflow({
  baseUrl: "https://your-paiflow-instance.example",
  token: deploymentToken, // keep this credential in your Node server
});
const deployment = client.deployment(deploymentId);
const { data: capabilities } = await deployment.capabilities.get();
const { data: balances } = await deployment.balances.get();
const quote = await deployment.swap.quote({ amountStroops: "10000000", nodeId: "swap" });
const transaction = await deployment.transactions.get(txHash);

for await (const page of deployment.events.pages({ txHash, limit: 50 }, { maxPages: 20, signal })) {
  // Store page.data.nextCursor, including on an empty final page, for later polling.
  consume(page.data.items);
}
```

Methods return `{data, metadata}`. Money remains integer strings. Capability support
is not live readiness; balance freshness, stale nodes and incomplete totals stay visible.
Swap quotes estimate one deployed node, not an execution guarantee. Transaction
UNKNOWN/REJECTED, event absence and network failures do not authorize replacing a payment.
Response shapes follow the current v1 schemas and public route returns; unrelated
extra fields are ignored. OpenAPI preserves extra document fields. Read bodies are
bounded to 4 MiB and schema collections to 10,000 entries (events pages max 100).

`events.list(query, options)` makes one request. `events.pages(query, options)`
retains limit/hash filters, deduplicates by eventId across its pages, and rejects
repeated/cyclic cursors when `hasMore` is true. Default page cap is 100 (configurable
1–10,000). Hitting the cap ends iteration with the final yielded cursor available
for explicit continuation; it does not mean history is complete. Cancellation throws
`PaiflowAbortError`. Each page has its own request timeout. Stop or abort on consumer
errors; there are no automatic retries or polling loops.

Public methods work without a token and never send a configured bearer credential:

- `client.getOpenApi(options)` returns the raw OpenAPI document as `data`.
- `client.createDemoToken(options)` explicitly requests a short-lived demo token.
  Construction and reads never create tokens; availability depends on operator setup.
- `deployment.publicSchedule.get(options)` reads the legacy public streamer state.
- `deployment.embed.activity(options)` returns at most 50 projected public events.
- `deployment.urls.payment({amount: "1.25"})`, `.allowance()` and `.embed()` generate
  hosted URLs without checking eligibility or sending HTTP requests. Payment amount
  hints are decimal token text with at most seven decimals, not stroops; flow rules
  can override them. Helpers do not expose owner-only QR routes.

## Public embed stream

```ts
for await (const message of deployment.embed.stream({ signal, timeoutMs: 60_000 })) {
  if (message.data.event === "snapshot") render(message.data.snapshot.events);
}
```

One call opens one public connection and yields typed `connected` and `snapshot`
messages. Snapshots contain the latest 50 public projected events, not complete
cursor history or individual acknowledgements. Duplicate eventIds within a snapshot
are removed; consumers deduplicate across snapshots using eventId and correlate
payments using txHash. Do not append every snapshot as if it were new history.
Use token-authenticated events for complete indexed history.

The server closes streams after 55 seconds; reconnect explicitly with bounded
backoff and consume the new snapshot. Default stream lifetime timeout uses the
client's timeout (30 seconds by default); set 60 seconds for a complete server
connection. Abort or breaking iteration cancels the reader and releases listeners
and timers. Parser frames are bounded to 262,144 characters and individual chunks
to 1 MiB. Malformed known events fail safely; unknown events and heartbeats are
ignored. SSE admission errors retain HTTP metadata/Retry-After with a generic
`HTTP_ERROR`, including plain-text 503 responses, without exposing server bodies.
Neither stream closure nor fallback polling establishes transaction finality.

These features are verified against source contracts and local fixtures, not fresh
hosted testnet transactions. Full workflow validation remains in #964.

## Payments and signing

```ts
import { Paiflow, signPrepared } from "@paiflow/sdk";

const flow = new Paiflow({ baseUrl: "https://your-paiflow-host.example", token }).deployment(id);
const prepared = await flow.execute.prepare({ amount: "10000000", from: walletAddress });
// Persist prepared before requesting consent. The callback signs the unchanged envelope
// using the server passphrase. Implement it using your own wallet integration.
const signed = await signPrepared(prepared, signTransaction, {
  walletAddress,
  expectedNetwork: "testnet",
  signal,
  timeoutMs: 120000,
});
// Persist original signed envelope before submission; retain it after uncertainty.
const result = await flow.execute.submit(signed.submission, {
  ...signed.submissionOptions,
  wait: false,
  signal,
});
// HTTP success may return FAILED or PENDING; inspect result.data.status.
```

The callback receives `{xdr, networkPassphrase, walletAddress, signal}` and returns
`{signedXdr}`. It must sign the original transaction without changing its source,
sequence, operations or time bounds. The SDK validates string bounds, network and
provided wallet metadata; it does **not** parse XDR, verify operations, or determine
the signer from the envelope. Execute/public preparation contains no wallet field:
pass the same address used in prepare; your wallet integration must check the source.
Before submission, bind the returned signed envelope to your saved original
preparation. The [payment example](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/examples/payment-server.ts)
compares transaction-body hashes using an optional application Stellar dependency.
Existing execute envelope validation does not bind a payment to your application
order price. Verify business receipt conditions before fulfilment.
No private keys are accepted. Callback exceptions are replaced with a generic signing
error; cancellation and the deadline settle even if a wallet ignores AbortSignal.
The helper never sends a transaction. Preserve the original preparation on failure.

`signPrepared` preserves the exact preparation response and returns submission
options linking its history UUID when available. It accepts `xdr` or `unsignedXdr`,
using a server passphrase or the canonical passphrase for a server-returned network.
It rejects conflicting fields, unsupported networks, wallet mismatch when a wallet
field exists, and expired preparation before/after signing. These guards do not
prove replacement safety or recover finality.

`execute.submit({signedXdr}, {wait})` defaults to server wait behavior. There are no
automatic retries, replacement envelopes, signing retries or polling loops. After
uncertainty preserve the original signed envelope/hash and explicitly query
`transactions.get(hash)` or resubmit that same envelope when appropriate. UNKNOWN,
REJECTED, missing transactions and elapsed time do not authorize a new payment.

Public methods are separate and omit deployment tokens:
`publicPayment.prepare({amount,userAddress})`, `publicPayment.submit({signedXdr})`,
and `publicPayment.status(txHash)`. Preparation returns only XDR/passphrase; it has
no expiry, hash, intent or receipt. Submission returns `{txHash,status?:"PENDING"}`.
Status returns SUCCESS/FAILED/PENDING with optional errorMessage. It is global chain
lookup: SUCCESS does not prove this deployment executed, and NOT_FOUND appears as
PENDING. It provides no receipt reconciliation or replacement-safety evidence.
A public submit 502 may be uncertain; never automatically create a replacement.
Amounts are positive integer stroop strings bounded to i128; never floating point.

## Funding

Funding supports deployed STREAMER Schedule and WEBHOOK pool nodes. These calls
add funds only; they do not execute a payout, reward or Webhook callback.
All HTTP funding methods require a developer or deployment token. The token grants API access;
any consenting funder's wallet signs, independently of the owner or controller.

```ts
const discovery = await flow.funding.get();
const node = discovery.data.nodes.find((node) => node.nodeId === chosenNodeId);
if (!node) throw new Error("Choose a supported funding node");
const prepared = await flow.funding.prepare({
  nodeId: node.nodeId,
  fromAddress: fundingWalletAddress,
  tokenContractAddress: node.tokenContractAddress,
  amountStroops: "10000000",
});
// Persist preparation, including action/intent/txHash, before opening the wallet.
const signed = await flow.funding.signPrepared(prepared, signTransaction, {
  walletAddress: fundingWalletAddress,
  expectedNetwork: "testnet",
  signal,
});
// Persist the signed envelope before submitting. This helper does not submit.
const submitted = await flow.funding.submit(signed.submission, {
  ...signed.submissionOptions,
  signal,
});
const status = await flow.transactions.get(prepared.data.txHash);
const recovery = await flow.funding.reconcile({
  action: prepared.data.action,
  intent: prepared.data.intent,
});
// Inspect recovery.data.state explicitly; no replacementAllowed field is provided.
```

`funding.signPrepared` applies the existing signing callback/cancellation protocol,
checks the funding wallet against `fromAddress`, and returns exact
`{action,intent,signedXdr}` submission arguments, the original preparation and
history correlation options. It enforces funding's 1–100,000-character signed XDR
limit. Use this funding-specific helper rather than the top-level payment helper.
The callback must sign the unchanged envelope using the server's passphrase.
No wallet SDK or private key is accepted by this package.

Discovery reads live assets, exposes authorization/effect, and supports at most
sixteen candidates. Choose `nodeId` explicitly if several nodes exist; the SDK
never chooses one or guesses an asset. Amounts must be positive canonical integer
strings up to i128::MAX, with no leading zeroes. Request bodies contain only the
published fields; extra caller properties are omitted. Submission returns the
existing transaction status including UNKNOWN or REJECTED; HTTP 200 alone does
not prove finality. Response parsers tolerate additive fields without inventing
recovery flags.

One unresolved intent per node blocks replacement funding and controls across
wallets. Conflict errors preserve the existing intent/hash in `error.fields`.
Reconcile that original intent. Reconciliation returns PREPARED, SUBMITTING,
SUCCESS, FAILED or ledger-proven EXPIRED. Only durable terminal finality or
ledger-proven expiry releases the reservation. UNKNOWN, REJECTED, missing history,
404, timeout, elapsed `expiresAt`, signing cancellation or absent events never
permit a replacement deposit. The helper's expiry guard only prevents signing a
stale envelope. There are no automatic retries, re-preparations, submissions or
reconciliation calls. Retain receipts and explicitly query/reconcile after errors.
Bounded testnet Schedule and Webhook funding/submission/reconciliation passed
with separate balance/event evidence in the
[live evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-14-sdk-live-verification.md).
See the [funding API documentation](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/funding.md).

### Schedule controls

`deployment.schedule.get({ nodeId })` reads controller, permissions, eligibility,
holdings and vested entitlement as distinct stroop strings. Contract controllers
can be read; wallet controls require the current G-address controller. A deployment
token grants API access, never wallet consent.

Each of `schedule.pause`, `schedule.resume`, and `schedule.retrieve` exposes
`prepare({ walletAddress, nodeId? })`, optional `signPrepared(prepared, signer,
options)`, `submit({ intent, signedXdr }, options?)`, and `reconcile({ intent })`.
Signing retains the original preparation and history linkage; it uses the canonical
passphrase for the server-returned network. Submit remains an explicit separate call.
Retrieve alone returns recipient, token and estimated amount. Callers cannot choose
recipient or amount; execution determines the final retrieval to the controller.

Preserve the original action, intent and transaction hash when interrupted. Reconcile
through that action namespace and preserve `replacementAllowed` from the server.
Local expiry, wallet denial, timeout, UNKNOWN or missing history never permits a
replacement. No method automatically signs, submits, resends or prepares another
intent. Bounded testnet funding, pause/resume/retrieve and original-intent
reconciliation passed in the [live evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-14-sdk-live-verification.md).
This does not establish unattended scheduler availability or natural scheduled
release. See [Schedule API controls](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/schedule-controls.md).

## Subscription and public allowance consent

`deployment.subscription.get()` reads token-authenticated live state, including
`templateKind`. `cancel` and `reactivate` each expose explicit `prepare`,
`signPrepared`, `submit` and `reconcile`. Preparation requires the configured
subscriber's `walletAddress`; the token supplies API access, never wallet consent.
Cancellation revokes allowance. Reactivation grants no allowance and triggers no
immediate charge. Neither action changes recipients or creates another customer
subscription. Existing Dev variants work only where the API permits the operation;
there are no SDK Dev setters or new deployment/configuration helpers.

```ts
const control = deployment.subscription.cancel;
const prepared = await control.prepare({ walletAddress: subscriberAddress });
// Save the original intent, hash, network and preparation/history metadata.
const signed = await control.signPrepared(prepared, signer, {
  walletAddress: subscriberAddress,
  expectedNetwork: "testnet",
});
const result = await control.submit(signed.submission, signed.submissionOptions);
// Explicit recovery, including UNKNOWN or lost submission responses:
const reconciled = await control.reconcile({ intent: prepared.data.intent });
```

Control reconciliation preserves the server's action, state, nullable ledger and
`replacementAllowed`; it has no network field. Keep the reservation while
PREPARED/SUBMITTING or finality/history is uncertain. Local timeouts and expiry do
not authorize a new intent. Controls use UUID intents and signed XDR length
1–100000, distinct from public approval.

`deployment.subscription.allowance` exposes public `get`, `prepare`, `submit`,
`status` and optional `signPrepared`. These methods omit the deployment bearer
token, even when the client has one. Public state omits `templateKind`.
`prepare({ amount, userAddress })` adds a positive integer-string amount to the
current allowance: it does not deposit funds or immediately charge the customer.
The server checks the cumulative i128 limit. Leading zero inputs are accepted as
by the source schema; use strings throughout.

```ts
const allowance = deployment.subscription.allowance;
const state = await allowance.get();
const prepared = await allowance.prepare({
  amount: "10000000",
  userAddress: subscriberAddress,
});
const signed = await allowance.signPrepared(prepared, state, signer, {
  walletAddress: subscriberAddress,
  expectedNetwork: "testnet",
});
const result = await allowance.submit(signed.submission, signed.submissionOptions);
const status = await allowance.status({ intent: prepared.data.intent });
```

The allowance signing helper takes an explicitly fetched state snapshot because
public preparation exposes only `xdr`, opaque signed `intent`, `txHash`,
`networkPassphrase` and cumulative `allowance`. It checks the snapshot deployment,
network, configured subscriber, cancellation and setup state before invoking the
callback. It makes no extra read and cannot prove snapshot freshness or bind the
opaque intent/envelope to those identifiers. The server remains authoritative
for live eligibility and exact signed-envelope/intent binding. The SDK does not
decode or verify the opaque intent, parse XDR operations, or invent expiry fields.
The signer must sign the unchanged envelope using the server's passphrase.

Keep the original preparation, intent/hash and history metadata through wallet
rejection, cancellation and uncertain submission. Allowance submit requires
signed XDR length 10–200000 and intent length 10–4096. Status uses the same opaque
intent, including after submit-intent expiry; do not log its URL. Public status
preserves SUCCESS/FAILED/PENDING and optional `errorMessage`, with no invented
network or `replacementAllowed` flag. PENDING and unavailable RPC retain unknown
finality; do not replace approval just because wall-clock time passed. This SDK
never retries, re-prepares, submits from a signing helper or initiates a charge.
A positive final allowance status permits a separate deliberate subsequent
approval; server-proven expired-without-confirmation is returned as FAILED.
Bounded testnet allowance, charge/payout, cancellation and reactivation passed
using the current deployed contract code; the final controlled fixture is cancelled
with zero allowance. The charge used an authorized manual cron call, so unattended
scheduling is not established. See the [live evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-14-sdk-live-verification.md)
for exact revisions, receipts and historical fixture limitations.

## Webhook callbacks and early release

Webhook pool top-ups use `funding`; callbacks release an already funded pool.
Authenticate each callback with an explicit `webhookSecret`, separately from the
client's deployment token. Persist a stable event key and its effective arguments
before calling; the SDK never generates a key or retries a request.

```ts
const reward = await deployment.webhook.trigger(
  { escrow: true, amount: "100000000" },
  { webhookSecret, idempotencyKey: persistedCompletionKey },
);
```

Webhook amounts are canonical integer stroop strings within nonnegative i128.
For escrow, omitting `amount` or passing `"0"` releases the entire available pool.
The SDK sends only relevant fields. Native execution uses `{ from, amount,
 auth?: string[] }` (`escrow` omitted or false); `auth` holds opaque caller-signed
Soroban authorization entries, not private keys. A webhook secret does not supply
wallet consent; the server/contract enforce required authorization. The SDK does
not build or sign these entries. Keep them out of logs.

Keyed results retain `attemptId`, `network`, `status`, optional `txHash`, `ledger`
and `error`. HTTP 202 with PENDING/UNKNOWN is not a confirmed payout. Explicitly
repeat the same key and effective arguments to recover the original attempt; if
there is a hash, `transactions.get(hash)` uses the separately configured deployment
token for tracking. Changed effective arguments return 409. Keys never expire or
reopen automatically. UNKNOWN without a hash requires operator review. A timeout,
error or missing hash never permits a fresh key, a replacement or an unkeyed call.

`webhook.triggerUnkeyed(input, { webhookSecret })` preserves legacy compatibility:
every deliberate call can pay again. It never sends an idempotency header, even
if extra untyped options contain a key. Its result is `{txHash, status?: "PENDING"}`,
with no invented network, attempt ID or SUCCESS status. Never replay an uncertain
unkeyed callback. Both methods retain HTTP status and response metadata.

`deployment.releaseEarly({ nodeId })` requests the before side of an eligible
timelock branch using the deployment token and server relayer. With one candidate,
`releaseEarly()` sends `{}`; with multiple candidates, choose their actual node ID.
Node IDs are trimmed and limited to 1–128 characters. The server enforces confirmed
active deployment, correct node, live deadline, held funds and relayer support.
The SDK never redirects to the after side or retries. A successful response retains
`nodeId`, `txHash` and optional `ledger`; it contains no invented network field.
Authorize your own application's requester before using either server-held credential.
Bounded testnet pool funding, keyed escrow payout/replay/conflict, native Webhook
execution and early release passed with independent finality and matching payouts.
Native consent retained both the recorded source-account authorization and the
wallet's bounded signed authorization. The original rejected attempt remains
preserved; its definitive pre-submission failure was established before a fresh
nonce/event was authorized. See the
[live evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-14-sdk-live-verification.md) for
receipts, scope and remaining verification gates.

JSON response bodies are limited to 4 MiB by default, including errors and payment/control receipts. Invalid or oversized successful responses produce a typed malformed response error; unreadable error responses retain HTTP status with a generic HTTP error. POST requests are never automatically repeated. Low-level `transport.request` callers may supply an explicit positive integer `maxResponseBytes`.

## Verification scope

Bounded testnet workflows have
been verified in the [live evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-14-sdk-live-verification.md)
and [real Swap execution report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-15-sdk-swap-execution-982.md).

One authorized testnet Swap completed 0.1 XLM → 0.0106193 USDC to the controlled
wallet, with independent finality and zero pipeline balances. Its net transaction
fee was 51.6198331 testnet XLM, including 51.6169576 XLM rent. A later unsigned
estimate was lower; it was not another execution or a guarantee of future fees.
Testing demo-token minting is disabled, and unattended scheduling was not established.

Developer credentials and discovery require a backend implementing OpenAPI revision
`1.1.0`; verify its deployed specification and capabilities before use. The
[hosted testing report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/verification/developer-tokens-hosted-verification-2026-10-16.md)
records bounded testnet evidence, not production/mainnet availability.

## Contributor checks and local artifacts

For a local source build, pack and install the tarball:

```sh
pnpm sdk:build
mkdir -p /tmp/paiflow-sdk-artifacts
npm pack ./packages/sdk --ignore-scripts --pack-destination /tmp/paiflow-sdk-artifacts
# In your Node ESM consumer (use the actual emitted filename):
npm install /tmp/paiflow-sdk-artifacts/paiflow-sdk-0.2.0.tgz
```

From the repository root, after installing root development dependencies:

```sh
pnpm sdk:build
pnpm sdk:typecheck
pnpm sdk:test
pnpm sdk:test:package
```

The package uses the repository's existing TypeScript compiler without inheriting
its Next.js configuration. No pnpm workspace is introduced. Artifact validation also compiles and runs the [consumer examples](https://github.com/artisam-paiflow/paiflow/tree/develop/packages/sdk/examples)
using the packed SDK. It packs into a temporary directory, installs that tarball into a clean consumer,
checks ESM import and declarations, and rejects unexpected published files.
Generated output and tarballs are ignored by Git. The package's `prepack` script
builds declarations and JavaScript before normal packing.

### Generate the method/type reference

Run `pnpm sdk:docs` after changing public SDK exports or TSDoc. CI runs
`pnpm sdk:docs:check`, which generates into a temporary directory and compares
all files without rewriting the checked-in reference. Documentation is derived
only from `src/index.ts`; private fields and implementation source links are excluded.

TypeDoc and its Markdown plugin are development-only tools. They use the existing
SDK TypeScript configuration and avoid maintaining a custom type printer. The scoped
`minimatch@10>brace-expansion` override preserves the generator's compatible ESM
dependency while leaving older consumers on their existing override. Neither tool
is shipped in the npm SDK or added as a runtime dependency.
