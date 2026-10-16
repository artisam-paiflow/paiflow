# Node SDK contract and endpoint coverage

Implementation contract originating in [#954](https://github.com/webnxt-2030/pinkraft/issues/954), under
[#953](https://github.com/webnxt-2030/pinkraft/issues/953). The Node package implements this surface; it is not published and hosted
availability has not been established by local SDK tests. See the
[quickstart and migration guide](quickstart.md) for compiled examples.

## Scope and packaging

User decisions: TypeScript, Node first, existing deployments, a separate package
in this repository named `@paiflow/sdk`, with branches and PRs targeting `testing`.
The npm scope needs to be created; publishing is separately authorized.
Sources are the [quickstart](../hackathon/developer-api-quickstart.md),
[developer context](../hackathon/llms.md), [API reference](../api/README.md), and
actual handlers at `testing` baseline `e803520c` (2026-10-13).

Use `packages/sdk`, with independent package metadata, declarations, exports,
build configuration, changelog and tests. Prepare the first beta as `0.1.0` under
[release policy](../releasing.md); SDK versions do not match app versions. Declare
compatibility with API v1 and the explicitly listed unversioned routes.

Initially support Node `>=22.22.2 <23`, matching the repository's tested engine;
widen only after package-artifact runtime verification. Ship ESM only with typed
exports; CommonJS callers can use dynamic import. This avoids dual-package build
and identity complexity. Use native fetch, URL, AbortSignal and readable streams,
with optional fetch injection. No base-client wallet/Stellar dependency is needed.
Runtime code must not import Next.js, Prisma, server-only or backend aliases/modules.
Any dependency must satisfy repository justification and audit rules.

## Endpoint matrix

`V` = `/api/v1/deployments/{id}`; `P` = `/api/deployments/{id}`.
Methods are current deployment namespaces unless prefixed with `client`. HTTP
methods take request options; signing and URL helpers have their own options.
**Token** means server-side `Authorization: Bearer pfd_…` (developer token with
explicit deployment grants) or `pfk_…` (existing single-deployment token). A token never supplies
wallet consent. **Public** methods omit bearer credentials. Webhooks need their
own secret. Rates are requests per 60 seconds, per token/route unless stated;
one developer token shares each endpoint allowance across its selected deployments.
Developer `READ_ONLY` permits discovery and reads; `READ_OPERATE` also permits
preparation, submission, reconciliation and relayer operations. The server enforces
the [permission matrix](../api/developer-token-permissions.md) on every request.

Schema aliases below refer to these exact sources:

- **S**: [shared v1 schemas](../../lib/api/v1/schema.ts).
- **F**: [funding schemas](../../lib/api/v1/funding-schema.ts).
- **Q**: [Swap quote schemas](../../lib/api/v1/swap-quote-schema.ts).
- **C**: [control intent](../../lib/api/v1/control-intent.ts), including `WalletControlSubmitSchema`.
- **A**: [allowance schemas](../../lib/subscription/schema.ts).
- **D**: [discovery](../../lib/api/v1/discovery.ts) and [query schema](../../lib/developer-tokens/schema.ts).

| HTTP path                                | Proposed SDK method                                      | Auth/consent                                | Rate                               | Input → output authority                                                         | Issue |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- | ----- |
| GET /api/v1/deployments                  | `client.deployments.list(query) / .pages(query)`         | token; either permission                    | 60                                 | D: query → `{items:[{id,flowName,network}],nextCursor}`                          | #1032 |
| GET V/capabilities                       | `capabilities.get()`                                     | token                                       | 60                                 | S: DeploymentCapabilitiesSchema                                                  | #957  |
| GET V/balances                           | `balances.get()`                                         | token                                       | 30                                 | S: DeploymentBalancesSchema                                                      | #957  |
| GET V/swap-quote                         | `swap.quote(query)`                                      | token                                       | 20                                 | Q: SwapQuoteQuerySchema → SwapQuoteSchema                                        | #957  |
| GET V/events                             | `events.list(query) / events.pages(query)`               | token                                       | 120                                | S: ListEventsQuerySchema → ListEventsResponseSchema                              | #957  |
| GET V/transactions/{txHash}              | `transactions.get(txHash)`                               | token                                       | 60                                 | 64-hex hash → S: TransactionStatusSchema                                         | #957  |
| POST V/execute                           | `execute.prepare(input)`                                 | token; funding wallet signs next            | 30                                 | S: ExecutePrepareSchema → ExecutePreparedSchema                                  | #958  |
| POST V/execute/submit                    | `execute.submit(input, {wait})`                          | token + wallet                              | 30                                 | S: ExecuteSubmitSchema + ExecuteSubmitQuerySchema → ExecuteSubmittedSchema       | #958  |
| GET V/funding                            | `funding.get()`                                          | token; funding wallet for submit            | 10                                 | F: FundingDiscoverySchema                                                        | #959  |
| POST V/funding                           | `funding.prepare(input)`                                 | token; funding wallet for submit            | 10                                 | F: FundingPrepareSchema → FundingPreparedSchema                                  | #959  |
| POST V/funding/submit                    | `funding.submit(input)`                                  | token; funding wallet for submit            | 30                                 | F: FundingSubmitSchema → S: TransactionStatusSchema                              | #959  |
| POST V/funding/reconcile                 | `funding.reconcile(input)`                               | token; funding wallet for submit            | 30                                 | F: FundingReconcileSchema → FundingReconciledSchema                              | #959  |
| GET V/schedule/state                     | `schedule.get(query)`                                    | token                                       | 20                                 | S: ScheduleStateQuerySchema → ScheduleStateSchema                                | #960  |
| POST V/schedule/pause                    | `schedule.pause.prepare(input)`                          | token; controller signs next                | 10                                 | S: SchedulePrepareSchema → schedule implementation                               | #960  |
| POST V/schedule/pause/submit             | `schedule.pause.submit(input)`                           | token + controller wallet                   | 30                                 | C: WalletControlSubmitSchema → transaction status                                | #960  |
| POST V/schedule/pause/reconcile          | `schedule.pause.reconcile(input)`                        | token                                       | 20                                 | S: ScheduleReconcileSchema → schedule implementation                             | #960  |
| POST V/schedule/resume                   | `schedule.resume.prepare(input)`                         | token; controller signs next                | 10                                 | S: SchedulePrepareSchema → schedule implementation                               | #960  |
| POST V/schedule/resume/submit            | `schedule.resume.submit(input)`                          | token + controller wallet                   | 30                                 | C: WalletControlSubmitSchema → transaction status                                | #960  |
| POST V/schedule/resume/reconcile         | `schedule.resume.reconcile(input)`                       | token                                       | 20                                 | S: ScheduleReconcileSchema → schedule implementation                             | #960  |
| POST V/schedule/retrieve                 | `schedule.retrieve.prepare(input)`                       | token; controller signs next                | 10                                 | S: SchedulePrepareSchema → schedule implementation                               | #960  |
| POST V/schedule/retrieve/submit          | `schedule.retrieve.submit(input)`                        | token + controller wallet                   | 30                                 | C: WalletControlSubmitSchema → transaction status                                | #960  |
| POST V/schedule/retrieve/reconcile       | `schedule.retrieve.reconcile(input)`                     | token                                       | 20                                 | S: ScheduleReconcileSchema → schedule implementation                             | #960  |
| GET V/subscription/state                 | `subscription.get()`                                     | token                                       | 40                                 | S: SubscriptionStateSchema                                                       | #961  |
| POST V/subscription/cancel/prepare       | `subscription.cancel.prepare(input)`                     | token; subscriber wallet for submit         | 10                                 | S: SubscriptionControlPrepareSchema → SubscriptionControlPreparedSchema          | #961  |
| POST V/subscription/cancel/submit        | `subscription.cancel.submit(input)`                      | token; subscriber wallet for submit         | 30                                 | C: WalletControlSubmitSchema → transaction status                                | #961  |
| POST V/subscription/cancel/reconcile     | `subscription.cancel.reconcile(input)`                   | token; subscriber wallet for submit         | 30                                 | S: SubscriptionControlReconcileSchema → SubscriptionControlReconciledSchema      | #961  |
| POST V/subscription/reactivate/prepare   | `subscription.reactivate.prepare(input)`                 | token; subscriber wallet for submit         | 10                                 | S: SubscriptionControlPrepareSchema → SubscriptionControlPreparedSchema          | #961  |
| POST V/subscription/reactivate/submit    | `subscription.reactivate.submit(input)`                  | token; subscriber wallet for submit         | 30                                 | C: WalletControlSubmitSchema → transaction status                                | #961  |
| POST V/subscription/reactivate/reconcile | `subscription.reactivate.reconcile(input)`               | token; subscriber wallet for submit         | 30                                 | S: SubscriptionControlReconcileSchema → SubscriptionControlReconciledSchema      | #961  |
| POST V/release-early                     | `releaseEarly(input?)`                                   | token; server relayer executes              | 10                                 | S: ReleaseBeforeSchema → ReleasedSchema                                          | #962  |
| POST /api/webhooks/{id}                  | `webhook.trigger(input, {webhookSecret,idempotencyKey})` | x-webhook-secret; auth entries where needed | 20/deployment/IP                   | Local PostSchema → S: WebhookAttemptResponseSchema (keyed); legacy unkeyed shape | #962  |
| POST P/trigger                           | `publicPayment.prepare(input)`                           | public; wallet for submit                   | 20/deployment/IP                   | Local PostSchema {amount,userAddress} → {xdr,networkPassphrase}                  | #958  |
| POST P/submit-trigger                    | `publicPayment.submit(input)`                            | public; wallet for submit                   | 20/deployment/IP                   | Local SubmitSchema {signedXdr} → {txHash,status?: PENDING}                       | #958  |
| GET P/tx-status                          | `publicPayment.status(txHash)`                           | public; wallet for submit                   | 60/deployment/IP + 600/IP          | Local QuerySchema → {txHash,status: SUCCESS/FAILED/PENDING,errorMessage?}        | #958  |
| GET P/subscription-allowance             | `subscription.allowance.get()`                           | public; subscriber signs submit             | 40/IP                              | Public subscription state + allowance:string/setupRequired                       | #961  |
| POST P/subscription-allowance            | `subscription.allowance.prepare(input)`                  | public; subscriber signs submit             | 20/IP                              | A: AllowancePrepareSchema → public prepared shape                                | #961  |
| POST P/subscription-allowance/submit     | `subscription.allowance.submit(input)`                   | public; subscriber signs submit             | 20/IP                              | A: AllowanceSubmitSchema → {txHash,status,errorMessage?}                         | #961  |
| GET P/subscription-allowance/status      | `subscription.allowance.status({intent})`                | public; subscriber signs submit             | 60/IP + delegated tx-status limits | A: AllowanceStatusSchema → public transaction status                             | #961  |
| GET P/streamer-state                     | `publicSchedule.get()`                                   | public                                      | No route-local limit               | {paused,available:string,retrieveAllowed}                                        | #957  |
| GET P/embed/activity                     | `embed.activity()`                                       | public                                      | 600/IP shared public reads         | {events}: public projected latest 50, no cursor                                  | #957  |
| GET P/embed/events                       | `embed.stream()`                                         | public                                      | 600/IP reads + 120/IP connects     | SSE connected/snapshot messages                                                  | #957  |
| GET /api/v1/openapi.json                 | `client.getOpenApi()`                                    | public                                      | 60/IP                              | Raw OpenAPI; no data envelope                                                    | #957  |
| POST /api/v1/demo-token                  | `client.createDemoToken()`                               | public; explicit opt-in                     | 3/IP/hour + 60 instance/hour       | S: DemoTokenSchema                                                               | #957  |

Every V path maps to the same suffix under `app/api/v1/deployments/[id]/…/route.ts`.
Read rates from [limits](../../lib/api/v1/limits.ts), auth/headers from
[v1 wrapper](../../lib/api/v1/handler.ts), and public admission from
[service wrapper](../../lib/deployments/service-route.ts). Exact public handlers:
[trigger](../../app/api/deployments/[id]/trigger/route.ts),
[submit-trigger](../../app/api/deployments/[id]/submit-trigger/route.ts),
[tx-status](../../app/api/deployments/[id]/tx-status/route.ts),
[allowance read/prepare](../../app/api/deployments/[id]/subscription-allowance/route.ts),
[allowance submit](../../app/api/deployments/[id]/subscription-allowance/submit/route.ts),
[allowance status](../../app/api/deployments/[id]/subscription-allowance/status/route.ts),
[streamer-state](../../app/api/deployments/[id]/streamer-state/route.ts),
[embed activity](../../app/api/deployments/[id]/embed/activity/route.ts),
[embed SSE](../../app/api/deployments/[id]/embed/events/route.ts), and
[webhook](../../app/api/webhooks/[id]/route.ts). Demo access uses
[DemoTokenSchema/handler](../../app/api/v1/demo-token/route.ts).

## Public API and types

```ts
interface PaiflowOptions {
  baseUrl: string; // trusted application configuration
  token?: string; // required for token methods only
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  preparationRequestId?: string;
}
interface ResponseMetadata {
  status: number;
  requestId?: string;
  historyRequestId?: string;
  retryAfter?: string;
}
interface ApiResponse<T> {
  data: T;
  metadata: ResponseMetadata;
}
// Logical wire aliases below are explanatory, not separately exported types.
type Network = "testnet" | "mainnet";
type Stroops = string;
type TransactionState = "SUCCESS" | "FAILED" | "PENDING" | "UNKNOWN" | "REJECTED";
type IntentState = "PREPARED" | "SUBMITTING" | "SUCCESS" | "FAILED" | "EXPIRED";
```

`new Paiflow(options).deployment(id)` binds matrix namespaces to one deployment
UUID. One client may access several explicitly selected deployments with a developer
credential (`pfd_` plus 64 lowercase hex characters). Existing `pfk_` validation
and methods remain compatible; legacy `pkdev_` credentials are rejected.
Token management and flow/deployment creation remain excluded.

`client.deployments.list(query?, options?)` returns
`ApiResponse<ListDeploymentsResponse>` with `DeploymentSummary[]` items
(`id`, `flowName`, `network`) and nullable UUID `nextCursor`. Its optional
`ListDeploymentsQuery` accepts `cursor` and integer `limit` (1–100; server default 20).
The server returns eligible explicitly authorized deployments ordered by ID, including
at most one for a deployment token. Discovery is a current authorization snapshot;
selection edits, revocation or retirement can change subsequent results.
`client.deployments.pages(query?, options?)` yields the same typed responses,
stops at null, and rejects repeated, cyclic or backward cursors before yielding
the malformed page. `DeploymentPagesOptions.maxPages` defaults to 100 (1–10,000).
The final yielded cursor permits explicit continuation after the cap; completion
at the cap does not prove the entire scope was read. Cancellation throws
`PaiflowAbortError`; each request retains metadata and its own timeout, with no retries.
Responses parse from unknown, tolerate additive fields and cap items at 100.
These additions are unreleased and locally verified; package version remains
0.1.0 pending a separately authorized release.

Webhooks require a separate `webhookSecret` in each call’s options; it is
never inherited from the client token. The safe `webhook.trigger` requires
an explicit stable idempotency key; expose explicitly named `triggerUnkeyed` for
legacy compatibility with no retries. Never invent a new key after uncertainty.
No arbitrary header overrides or credential forwarding to redirected origins.

JSON methods return `ApiResponse<T>`: unwrap the server's `{data}` once, retain
HTTP status/metadata, and locally wrap raw OpenAPI. `PaiflowApiError` carries
status, code, message, fields, details and metadata. Separate transport, timeout,
abort and malformed-response errors. Do not attach raw requests/responses or log
bodies, credentials, intents or signed XDR. Validate required response fields but
tolerate additive server fields; unknown event payloads stay `unknown`, and future
error codes remain strings.

Export named request/response interfaces corresponding to the matrix authorities.
Preserve wire names (`amount`, `amountStroops`, `from`, `fromAddress`, `userAddress`,
`walletAddress`) and separate prepared/result types for every workflow. Opaque
signed allowance intents are distinct from UUID control intents; never decode or
rebuild them. Schedule prepared response uses `unsignedXdr`, **no passphrase**,
and short action names; funding and Subscription controls use `xdr` with passphrase.
Preserve these differences in raw types. Schedule response fields are defined by
[schedule implementation](../../lib/api/v1/schedule.ts); control submit results
by [control submission](../../lib/api/v1/control-submission.ts).

### Signing

```ts
interface SignRequest {
  xdr: string;
  networkPassphrase: string;
  walletAddress: string;
  signal?: AbortSignal;
}
type SignTransaction = (request: SignRequest) => Promise<{ signedXdr: string }>;
```

Explicit prepare/submit is primary. Optional `signPrepared` accepts the response,
initiating wallet address and callback, normalizes `xdr`/`unsignedXdr`, and returns
submission arguments without submitting. Preserve preparation, intent/hash and
history metadata before signing; a signing failure cannot trigger submit/reprepare.
Sign the exact transaction without changing operations, source, sequence, time
bounds or network. No secret-key API, wallet discovery or automatic account funding. The helper
does not parse XDR or verify the signed transaction body. Your application must
bind a returned signed envelope to the persisted original preparation before
submission; the payment example demonstrates hash comparison.
A Node app may forward the serializable XDR/passphrase/address fields to its
browser wallet (not the AbortSignal); wallet examples are not SDK runtime integrations.
Public allowance signing requires `subscription.allowance.signPrepared(prepared,
state, signer, options)` with an explicitly fetched public state snapshot. Other
workflow helpers take `(prepared, signer, options)`; use workflow-specific helpers
to retain each action/intent submission shape.

Use the server response passphrase. For Schedule, map its server-returned network
to the canonical Stellar passphrase in the signing adapter; never use wallet
runtime configuration or invent a missing response field. Public trigger/allowance
preparation has incomplete common metadata: derive network only from a recognized
server passphrase, reject unsupported passphrases, and do not invent expiry or
receipt fields. Network policy remains in [CLAUDE.md §7.5](../../CLAUDE.md#75-networks).

### Money, events and recovery

Keep money as integer strings, use bigint for arithmetic, and follow each schema's
positivity/i128 bounds. Never convert via floating-point token arithmetic. Bps,
page counts and ledgers are numbers. Quotes estimate one deployed Swap, not an
execution guarantee. Keep balance freshness, stale nodes and partial totals visible.

`events.pages()` is a bounded async iterator: follow `hasMore` and `nextCursor`,
stop on abort/page cap, reject non-advancing cursors when more pages are claimed.
Retain the last cursor on an empty final page for later polling. Deduplicate by
`eventId` and associate by `txHash`; event arrival/absence is not financial finality.

`embed.stream()` yields typed `connected` and `snapshot` SSE messages using a
bounded parser and AbortSignal. Snapshots contain the latest 50 public projected
events, not cursor history or individual acknowledgements. One call opens one
connection; reconnect explicitly with bounded backoff and consume the new snapshot.
Deduplicate using the [public event projection](../../lib/deployments/public-embed.ts)
identity; use token events for complete history. Streams close at 55 seconds,
with caps of 200 total, 40/IP, 60/deployment
([admission](../../lib/deployments/public-stream-slots.ts)). 503 can be plain text
with Retry-After. Closure or polling fallback says nothing about finality.

JSON responses are bounded to 4 MiB by default; low-level requests may set an explicit
positive byte limit. Oversized responses do not authorize replaying a write.
See the [beta validation checklist](release-checklist.md) for endpoint evidence and
outstanding live/release gates.

Default transport retries: none. Optional bounded GET retries may honor Retry-After,
jitter and cancellation. POST never automatically reprepares, signs or submits;
reconcile is explicit. Execute wait defaults true, but can still return PENDING.
A webhook 202 is successful HTTP with uncertain financial status. Timeout after
sending is uncertainty. Keep the original signed envelope/hash and use its correct
status/reconcile surface. UNKNOWN, REJECTED, 404, wall-clock expiry or network
failure alone never permits replacement. Control/funding reconciliation must
retain protocol state and ledger-proven finality/expiry. Subscription and Schedule
reconciliation return `replacementAllowed`; do not invent it for funding.

Public trigger has **no prepare receipt, intent, trigger-status route or receipt
reconciliation** at this baseline. Public tx-status is global chain lookup, reports
NOT_FOUND as PENDING, and proves neither deployment binding nor replacement safety.
Keep this legacy response separate from v1 TransactionStatus. Public allowance
has its own signed opaque intent/status expiry protocol, adds to existing allowance,
and does not deposit or charge. Its read response omits templateKind compared with
v1 Subscription state; prepare returns `{xdr,intent,txHash,networkPassphrase,allowance}`.

## Headers and limits

Send JSON Content-Type. Support `x-request-id` (1–128 characters matching
`[A-Za-z0-9._:-]`), capture returned request/history IDs and Retry-After when present.
`x-preparation-request-id` is the UUID preparation **history** ID for submit
correlation, not the caller's arbitrary request ID, authorization or idempotency.
Public routes may lack history headers. Webhook `Idempotency-Key` and effective
arguments stay stable; changing arguments returns 409, and keys do not expire/reopen.

Funding bodies are bounded to 110,000 bytes by
[fundingBody](../../lib/api/v1/funding-body.ts). Control/funding signedXdr allows
1–100,000 characters; execute/public trigger/allowance allows 10–200,000.
Allowance intent is 10–4096 characters. Events default 50/max 100, cursor max 512.
Node selectors max 128 where specified. Limits are endpoint-specific, not universal.
SDK checks cannot replace or weaken server validation.

## Exclusions, OpenAPI gaps and hosted verification

Exclude owner-session account/token management even though token routes appear in
OpenAPI; flow creation/deployment; admin/cron; legacy dev mutation; payroll
management/allowance; and v1 payouts/payouts-submit, which mutate dev-mode values
outside supported hackathon integrations. Include allowance for supported existing
Dev subscriptions without adding dev mutations. Owner-only `/events` SSE and
`/poll-events` are excluded; public embed SSE is included.

Hosted helpers generate `/trigger/{id}`, `/allowance/{id}` and
`/deployments/{id}/embed` at the configured origin, without claiming eligibility.
Trigger amount hints are decimal token text, **not stroops**, and flow rules override
them. Exclude owner-only `/qr` SEP-7/invocation QR and `/embed/qr`: the latter's
actual [handler](../../app/api/deployments/[id]/embed/qr/route.ts) requires owner
admission despite hosted embed docs suggesting a public QR. Do not change auth to
match docs. Generating the customer payment URL remains in scope; no new SEP-7 API.

[OpenAPI source](../../lib/api/v1/openapi.ts) and [JSON](../api/openapi.json) cover
included v1 routes and webhook. Public trigger/submit/tx-status, allowance,
streamer-state and embed activity/SSE are absent. Owner token management appears
but is excluded. Generate only allowlisted API types and maintain separate public
and SSE types; do not import backend schemas at runtime. Responses lacking Zod
schemas, especially Schedule and public routes, require route-return contract checks.
OpenAPI additions belong in separately scoped API documentation work if needed.

No live requests or financial transactions were performed for this inventory.
Hackathon guides explicitly mark funding, Schedule and Subscription controls as
pending hosted testnet verification. Allowance signing/charging/payout needs the
[manual rehearsal](../hackathon/manual-verifications.md). All other rows are also
source coverage, not a fresh hosted verification claim. Historical evidence from
reverted changes does not verify this baseline. #964 must record exact package/app
commits, testnet deployment, wallet consent, transaction finality and results before
claiming verified workflows. Publishing, deployment and promotion remain separate.
