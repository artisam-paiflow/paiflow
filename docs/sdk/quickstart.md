# TypeScript SDK quickstart and API migration

For one server credential across explicitly selected existing owned deployments, see the [developer-token guide](../api/developer-tokens.md). SDK `0.2.0` supports developer credentials and scoped discovery with a backend implementing OpenAPI revision `1.1.0`; SDK `0.1.0` does not include these additions. Existing deployment-only integrations remain supported. See the [SDK release record](release-checklist.md) for registry availability.

`@paiflow/sdk` is a Node SDK for existing Paiflow deployments. Beta `0.2.0`
provides developer credentials and scoped deployment discovery. Supports Node `>=22.22.2 <23`, ESM and TypeScript declarations;
CommonJS consumers can use dynamic import. SDK versions are independent of the app
and API under the [release policy](../releasing.md).

Developer-token discovery requires a backend implementing OpenAPI revision
`1.1.0`; check its deployed specification and capabilities. The
[hosted testnet evidence](../verification/developer-tokens-hosted-verification-2026-10-16.md)
records bounded testing and does not establish production/mainnet support.

All HTTP operations in the [coverage matrix](contract.md#endpoint-matrix) are
implemented, spanning API v1 and explicitly included unversioned user routes.
Local source/fixture tests do not establish fresh hosted/on-chain availability.
Some controls remain in the manual verification queue; see the linked
[API docs](../api/README.md) and operator deployment capabilities before integration.
This SDK does not create/deploy flows, manage dashboard sessions or expose legacy
Dev setters. Hackathon Dev mode remains disabled as documented in the
[hackathon feature policy](../hackathon/README.md#hackathon-feature-availability).

The [SDK README](../../packages/sdk/README.md) is the main detailed SDK entry point;
this page provides supplementary quickstart and migration examples.

## Install

Registry installation (when available):

```sh
npm install @paiflow/sdk@0.2.0
```

Use the exact version for reproducible installation; `@beta` follows the moving
beta tag. See the [release record](release-checklist.md) for registry availability.
You can also build and install the source artifact below.

### Build the local artifact

In this checkout, install the existing root dependencies, then:

```sh
pnpm sdk:build
mkdir -p /tmp/paiflow-sdk-artifacts
npm pack ./packages/sdk --ignore-scripts --pack-destination /tmp/paiflow-sdk-artifacts
```

In your own Node ESM app, install the actual emitted tarball filename:

```sh
npm install /tmp/paiflow-sdk-artifacts/paiflow-sdk-0.2.0.tgz
```

Set your consumer's `package.json` to `"type": "module"`. TypeScript consumers use
`module` and `moduleResolution` set to `NodeNext`. No wallet, Stellar, Next.js or
Prisma runtime dependency is required by the core SDK. The exact-envelope payment
example separately uses your app's optional `@stellar/stellar-sdk` dependency.
The repo checks it against its existing version; no new root dependency is added.

## First server read

Configure a fixed trusted HTTPS Paiflow origin, confirmed deployment UUID and
its `pfk_…` token on your Node server. The [API access instructions](../api/README.md#deployment-api-tokens)
explain token creation and active deployment requirements. Do not use a browser
request to select your API origin, deployment, token, price or payout destination.

```ts
import { Paiflow } from "@paiflow/sdk";

// Values supplied by your own server configuration layer, not browser inputs.
const client = new Paiflow({ baseUrl: paiflowOrigin, token: deploymentToken });
const deployment = client.deployment(deploymentId);
const capabilities = await deployment.capabilities.get();
const balances = await deployment.balances.get();
```

Every JSON method returns `{ data, metadata }`, rather than the raw fetch response.
`metadata` retains HTTP status, request/history IDs and Retry-After when supplied.
API HTTP success does not imply transaction success. Amounts at API boundaries are
integer **stroop strings** (1 XLM = `"10000000"`); use bigint for arithmetic.
Hosted payment URL amount hints are decimal token strings, e.g.
`deployment.urls.payment({ amount: "1.25" })`, and can be overridden by flow rules.

## Two explicitly selected existing deployments

On a supporting build, sign in at `/account/developer`, select both existing owned
CONFIRMED ACTIVE deployments and create a Read only credential. The panel does not
automatically add future deployments. For operations, create a separate replacement
with Read and operate and review the [permission matrix](../api/developer-token-permissions.md).
Label/permission/expiry cannot be edited; selection can be atomically replaced or
emptied. Revocation stops subsequent access, never cancels submitted work.

The [developer-server example](../../packages/sdk/examples/developer-server.ts)
exports `selectedDeployments(client, [idA, idB])`. Its `read(signal)` uses bounded
`client.deployments.pages` then reads capabilities and balances for those explicit
IDs. Discovery never selects an arbitrary deployment for your business action.

To run reads in your own ESM consumer after local tarball installation, copy
`developer-server.ts` and `payment-server.ts`, compile with TypeScript NodeNext
(using the optional Stellar dependency described above), then:

```js
import { readConfiguredDeployments } from "./compiled/developer-server.js";
// Your app supplies its own validated configuration/secret manager; no customer keys.
const results = await readConfiguredDeployments(
  {
    baseUrl: configuredPaiflowOrigin,
    token: await secretStore.get("paiflow-developer-token"),
    deploymentIds: [configuredDeploymentA, configuredDeploymentB],
  },
  AbortSignal.timeout(30_000),
);
// Use results in your server; never serialize credential-bearing configuration.
```

Supply `baseUrl`, server-only `token` and two explicit `deploymentIds` through your
consumer application's validated configuration/secret manager. Run only against
a service you control and have confirmed supports this contract. For an offline
run of both reads and the operate callback, use `pnpm sdk:test:package` below.

`selection.payment(idA, dependencies)` composes the existing authenticated,
original-envelope-bound handlers described below. `operateOnce` demonstrates
prepare → separate caller-owned wallet callback → submit, with receipt verification.
Implement durable dependencies; the wrapper requires and checks each order's immutable `deploymentId` before preparation/submission. Also bind its user, trusted catalogue price and wallet. The callback must show network, amount
and configured recipients and obtain explicit consent; do not pass customer keys
to this server. The browser adapter below renders the required network chip.
`operateOnce` is one explicit attempt, never an automatic financial retry loop.
After uncertain submission retain the original evidence; use a still-authorized
same-deployment credential or owner recovery path to check the original hash.

## Payment: your Node server and the customer's wallet

The [server example](../../packages/sdk/examples/payment-server.ts) exports
framework-neutral `prepare` and `submit` handlers. The
[browser example](../../packages/sdk/examples/payment-browser.ts) binds a button,
network chip and inline error to those handlers. These are adapters for an existing
application, not a ready-to-deploy payment service.

1. Bind handlers to `/checkout/prepare` and `/checkout/submit` on your own origin.
   Configure fixed `appOrigin`/`paymentDescription` and implement `authenticate`,
   a durable `withOrder` lock/store and `verifyReceipt`.
   Authenticate ownership before preparing/submitting; wallet address comes from
   your verified account link, and order price comes from your trusted catalogue.
   Apply application rate limits and generic error responses in your route adapter.
2. Persist the original server preparation before wallet consent. Repeat prepare
   requests return that preparation; local expiry never silently builds another.
3. Inject Freighter into `bindCheckout(button, chip, error, orderId, freighter, review)`.
   The browser imports SDK **types only**. The adapter follows the official
   [Freighter connection](https://github.com/stellar/freighter-developer-docs/blob/main/extension/connecting.md)
   and [transaction signing](https://developers.stellar.org/docs/build/guides/freighter/prompt-to-sign-tx)
   interfaces. Your bundler can import `isConnected`, `requestAccess` and
   `signTransaction` from your separately installed `@stellar/freighter-api`.
   Implement `review` to render the returned catalogue price and trusted
   `paymentDescription` recipient/token rules and await explicit consent. The chip uses
   the server network with `data-testid="network-chip"`; signing uses the exact
   returned XDR/passphrase, never the wallet's network configuration.
4. Before SDK submission, compare signed and persisted prepared transaction-body
   hashes under the server passphrase. Added signatures are allowed; changed source,
   sequence, operation, amount, time bounds or fee-bump wrapping is rejected. Persist
   the original signed envelope and hash before sending; never log either envelope.
5. Mark paid only after your application's receipt verifier proves final success,
   matching deployment/trigger, hash, payer, token, exact order price and expected
   recipient payouts. Incomplete evidence keeps the order unfulfilled. A recovery
   worker uses the same verifier and original hash, without preparing replacements.

The SDK's optional `signPrepared(prepared, signer, { walletAddress })` callback
receives XDR, server passphrase, wallet address and AbortSignal, returning
`{ signedXdr }`. It signs once and never submits. It does **not** parse XDR or
cryptographically bind the returned envelope to the preparation. Existing execute
backend checks do not bind the transaction to your application's original order
price; the example's server-side comparison is essential. Comparison binds the
body, not signature validity; chain submission validates signatures.

The example uses injected production persistence/auth/receipt logic. The fixture
store in `check-examples.mjs` is deliberately local and not production storage.
Do not send deployment tokens, webhook secrets, wallet private keys, opaque intents
or signed authorization entries to logs; signed envelopes stored for recovery need
restricted access. API credentials never authorize arbitrary application users to
release funds or pay rewards. Authorize those business actions in your own server.

## Other workflows and explicit recovery

[workflows.ts](../../packages/sdk/examples/workflows.ts) provides compilable
functions with a caller signer and restricted durable journal. Authenticate and
validate application inputs before calling them; server-selected node IDs/assets
and business amounts remain application policy. A browser signing bridge can
forward serializable XDR/passphrase/address fields, not AbortSignal. Cancellation
settles the Node helper but cannot undo wallet actions or submitted transactions.

| Workflow         | Example and recovery                        | Critical distinction                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Funding          | `fund`, `recoverFunding`                    | Select an actual discovery node and token. Deposit into Schedule/Webhook pool, not a payout. Preserve action, UUID intent and hash. No `replacementAllowed` field.                                                                                                 |
| Schedule         | `pauseSchedule`, `recoverPause`             | Configured controller signs. `resume` and `retrieve` use the same explicit pattern; only retrieve returns recipient/estimated amount, and caller cannot select either. Reconcile preserves server `replacementAllowed`.                                            |
| Subscription     | `cancelSubscription`, `recoverCancellation` | Subscriber signs cancellation; cancellation revokes allowance. `reactivate` does not grant allowance or immediately charge. Control reconcile retains nullable ledger and `replacementAllowed`, without network.                                                   |
| Public allowance | `approveAllowance`, `recoverAllowance`      | Fetch public state explicitly and pass it to `allowance.signPrepared(prepared, state, signer, options)`. Amount adds to existing allowance; it is not a deposit or charge. Keep opaque intent, distinct from control UUIDs. Public status has no replacement flag. |
| Webhook          | `reward`                                    | Authorize trusted application event; persist stable key/effective arguments first and supply `webhookSecret` per call. Recovery repeats that same key/arguments; never use a fresh key or unkeyed fallback.                                                        |
| Indexed history  | `ingestEvents`                              | Atomically store events uniquely by `eventId` and cursor/hasMore with the original filters. Max-page termination is not proof of complete history.                                                                                                                 |

For early release, authorize the application's operator and configured timelock
node, then explicitly call `deployment.releaseEarly({ nodeId })`. The server relayer
executes the eligible before branch; your deployment token is not wallet consent.
Never expose this as an unrestricted browser action. The server enforces eligibility,
but the SDK cannot know your business permissions. No automatic retries occur.

Persist preparations and signed submissions in separate stages; the journal calls
in the example are checkpoints, not permission to overwrite unrelated financial
history. On interrupted submit, use the original hash with `transactions.get` and
its workflow's reconcile/status method. Errors may retain conflicting intent/hash
in `PaiflowApiError.fields`; inspect privately, not by logging whole errors.
Timeout, cancellation, UNKNOWN/REJECTED, 404, missing events or elapsed wall-clock
expiry does not authorize a replacement. Schedule/Subscription replacement requires
server evidence; funding reservation release needs durable terminal finality or
ledger-proven expiry. Allowance uses its own public status protocol. An unresolved
Webhook without a hash needs operator review. The SDK does not poll or retry writes.

Public payment status is a global chain lookup and SUCCESS alone is not a matching
deployment receipt. Public embed SSE yields latest-50 snapshots, not complete
history; deduplicate across snapshots and reconnect explicitly with bounded backoff.
Authenticated event pagination is the indexed-history surface.

## Migrate from direct HTTP calls

Keep your existing API base URL, deployment UUID, authentication and business
validation. Replace endpoint construction/fetch/unwrap with the matching SDK method:

| Existing HTTP surface                         | SDK namespace                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| v1 capabilities, balances, swap quote         | `capabilities.get`, `balances.get`, `swap.quote`                              |
| v1 tx-status and events                       | `transactions.get`, `events.list` / `events.pages`                            |
| v1 execute and execute/submit                 | `execute.prepare`, `execute.submit`                                           |
| v1 funding discovery/prepare/submit/reconcile | `funding.get/prepare/submit/reconcile`                                        |
| v1 Schedule state and actions                 | `schedule.get`, `schedule.pause/resume/retrieve`                              |
| v1 Subscription state and controls            | `subscription.get`, `subscription.cancel/reactivate`                          |
| Public trigger/submit-trigger/tx-status       | `publicPayment.prepare/submit/status`                                         |
| Public subscription-allowance                 | `subscription.allowance.get/prepare/submit/status`                            |
| Webhook callback and v1 release-early         | `webhook.trigger` / explicit `triggerUnkeyed`, `releaseEarly`                 |
| Public streamer state and embed               | `publicSchedule.get`, `embed.activity/stream`, `urls.payment/allowance/embed` |
| OpenAPI and demo-token                        | `client.getOpenApi`, `client.createDemoToken`                                 |

Use the [full endpoint matrix](contract.md#endpoint-matrix) and
[package reference](../../packages/sdk/README.md) for individual shapes/limits.
Unversioned routes keep their distinct legacy responses and authentication;
they are not transformed into v1 receipts. Public methods omit bearer tokens,
even if a token was configured. Webhooks require their separate per-call secret.

Handle `PaiflowApiError` for HTTP errors and SDK transport/timeout/abort/malformed
response errors separately. Request options allow `signal`, `timeoutMs`, request ID
and preparation history correlation. Rate-limit metadata is evidence for a deliberate
bounded recovery policy, not automatic permission to replay a write. Keep your
original transaction and intent persistence when migrating; SDK helpers do not
replace application authorization, wallet consent or receipt verification.

## Run the examples without live transactions

From the repo root:

```sh
pnpm sdk:test:package
pnpm sdk:test
```

The package checker installs the locally packed tarball into an isolated temporary
ESM consumer, compiles the maintained TypeScript examples against exported declarations,
and runs local tampered-envelope, ownership/origin, receipt-gating and pagination
fixtures. Optional Stellar/Node dev dependencies are reused locally. Example
compilation skips third-party declaration internals because the existing Stellar
SDK lacks js-xdr declarations; SDK-only declaration validation remains strict.
Examples/scripts are excluded from the published artifact allowlist. No hosted
calls, funding, wallet credentials, npm publication or deployments occur.
