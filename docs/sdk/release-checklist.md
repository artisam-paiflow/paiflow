# SDK beta validation and release checklist

Local validation for [#964](https://github.com/webnxt-2030/pinkraft/issues/964)
began on 2026-10-13; the live checkpoint below is dated 2026-10-15. This first-beta candidate
is **unpublished**, with version `0.1.0` prepared on 2026-10-15. Bounded, separately authorized testnet workflows now have
[SDK live evidence](../testing/2026-10-14-sdk-live-verification.md); remaining
limitations, independent final-candidate review and exact-head CI remain separate
gates. Historical hackathon evidence does not establish this SDK's live support.
No release tag or npm publication is authorized by this checklist.

## Candidate identity and compatibility

- Package: `@paiflow/sdk@0.1.0`, first-beta release candidate dated 2026-10-15;
  npm publication and its final artifact integrity are not yet established. SDK
  and app versions advance independently.
- Source baseline: `testing` commit `71e9326b62d18bf9366ffbf0564fdd62847c3af6`,
  after the reviewed real-Swap evidence PR. Release preparation changes metadata
  and documentation; SDK runtime, tests, scripts and dependencies remain unchanged.
  Record the final release candidate's full commit, review, exact-head CI and new
  tarball integrity before approval. Historical packed-artifact integrity does
  not identify the release tarball after its metadata/docs change.
- npm ownership verified on 2026-10-15: authenticated account `saltshin` is an
  owner of the `@paiflow` organization. Registry lookup returned 404 for
  `@paiflow/sdk`; the name was unpublished at that check. These observations do
  not establish a completed publication, future access or registry availability.
- API: `/api/v1` plus the explicitly listed unversioned public/Webhook routes in
  [the contract](contract.md). No new backend routes or behavior changes.
- Runtime: Node `>=22.22.2 <23`, ESM only; CommonJS uses dynamic import. Locally
  verified with Node 22.22.2 and pnpm 10.4.1. Other Node versions are not claimed.
- No runtime dependencies, root dependency changes or wallet/private-key API.
  Optional Stellar SDK use is confined to consumer examples/tests.

## Local evidence

- `pnpm sdk:typecheck`: strict SDK source/declarations.
- `pnpm sdk:test`: 170 passing tests, including late JSON response cleanup on
  timeout/abort, invalid SSE timeout listener cleanup, default 4 MiB JSON bounds,
  public contract-address diagnostics and nested signed-authorization redaction.
- `pnpm sdk:test:package`: offline tarball install into a clean ESM consumer,
  declaration/export boundaries and file allowlist; compiled examples and local
  tampered-envelope rejection, ownership/origin, receipt gating and pagination.
  The checker plants obsolete JS/declaration files and rebuilds, proving both are
  removed before packing. Examples, tests and scripts remain outside the tarball.
- `pnpm typecheck`: repository TypeScript passes. Backend source is unchanged.
- `pnpm audit`: passes; one existing ignored low advisory, governed by root
  `pnpm.auditConfig.ignoreGhsas` and [#753](https://github.com/webnxt-2030/pinkraft/issues/753).
  This is not a claim of zero advisories.
- Existing API fixture checks cover OpenAPI, route coverage, funding routes,
  Schedule routes, Subscription controls and execute envelope validation.
  Six files / 185 tests pass. Full Node/Rust CI remains required on the final
  reviewed candidate.

All 42 matrix rows were matched to current `app/api/**/route.ts` files and their
exported HTTP method. The evidence below is **local contract/fixture evidence**,
not wallet signing, hosted availability or on-chain financial finality.
`V` = `/api/v1/deployments/{id}`; `P` = `/api/deployments/{id}`. Tests live under
[`packages/sdk/tests`](../../packages/sdk/tests). Every row is exposed through the
packed root export; signing and URL helpers add no extra HTTP surface.

| HTTP surface                             | SDK method                                               | Local validation evidence                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET V/capabilities                       | `capabilities.get()`                                     | reads.test.mjs: token route and protocol fields; malformed capability readiness rejected                                               |
| GET V/balances                           | `balances.get()`                                         | reads.test.mjs: freshness/partial totals, integer money, malformed address and freshness rejected                                      |
| GET V/swap-quote                         | `swap.quote(query)`                                      | reads.test.mjs: exact amount/query, i128 validation, numeric response money rejected                                                   |
| GET V/events                             | `events.list(query) / events.pages(query)`               | reads.test.mjs: filters, cursor bounds/loops, deduplication, cancellation and continuation                                             |
| GET V/transactions/{txHash}              | `transactions.get(txHash)`                               | reads.test.mjs: all five finality/uncertainty states and exact hash route                                                              |
| POST V/execute                           | `execute.prepare(input)`                                 | payment.test.mjs: explicit prepare/sign/submit, metadata, wait=false, uncertainty and no replay                                        |
| POST V/execute/submit                    | `execute.submit(input, {wait})`                          | payment.test.mjs: explicit prepare/sign/submit, metadata, wait=false, uncertainty and no replay                                        |
| GET V/funding                            | `funding.get()`                                          | funding.test.mjs: Schedule/Webhook discover/prepare/sign/submit/reconcile, exact inputs, conflict recovery and source OpenAPI examples |
| POST V/funding                           | `funding.prepare(input)`                                 | funding.test.mjs: Schedule/Webhook discover/prepare/sign/submit/reconcile, exact inputs, conflict recovery and source OpenAPI examples |
| POST V/funding/submit                    | `funding.submit(input)`                                  | funding.test.mjs: Schedule/Webhook discover/prepare/sign/submit/reconcile, exact inputs, conflict recovery and source OpenAPI examples |
| POST V/funding/reconcile                 | `funding.reconcile(input)`                               | funding.test.mjs: Schedule/Webhook discover/prepare/sign/submit/reconcile, exact inputs, conflict recovery and source OpenAPI examples |
| GET V/schedule/state                     | `schedule.get(query)`                                    | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/pause                    | `schedule.pause.prepare(input)`                          | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/pause/submit             | `schedule.pause.submit(input)`                           | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/pause/reconcile          | `schedule.pause.reconcile(input)`                        | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/resume                   | `schedule.resume.prepare(input)`                         | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/resume/submit            | `schedule.resume.submit(input)`                          | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/resume/reconcile         | `schedule.resume.reconcile(input)`                       | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/retrieve                 | `schedule.retrieve.prepare(input)`                       | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/retrieve/submit          | `schedule.retrieve.submit(input)`                        | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| POST V/schedule/retrieve/reconcile       | `schedule.retrieve.reconcile(input)`                     | schedule.test.mjs: each action prepare/sign/submit/reconcile, source-specific receipts, replacement evidence and controller consent    |
| GET V/subscription/state                 | `subscription.get()`                                     | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/cancel/prepare       | `subscription.cancel.prepare(input)`                     | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/cancel/submit        | `subscription.cancel.submit(input)`                      | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/cancel/reconcile     | `subscription.cancel.reconcile(input)`                   | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/reactivate/prepare   | `subscription.reactivate.prepare(input)`                 | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/reactivate/submit    | `subscription.reactivate.submit(input)`                  | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/subscription/reactivate/reconcile | `subscription.reactivate.reconcile(input)`               | subscription.test.mjs: state and both control lifecycles, exact consent, uncertainty and replacement evidence                          |
| POST V/release-early                     | `releaseEarly(input?)`                                   | webhook.test.mjs: selected/empty release body, eligibility errors, separate deployment token and no retries                            |
| POST /api/webhooks/{id}                  | `webhook.trigger(input, {webhookSecret,idempotencyKey})` | webhook.test.mjs: keyed/unkeyed wire shapes, stable caller key, conflicts, isolated secrets and native auth redaction                  |
| POST P/trigger                           | `publicPayment.prepare(input)`                           | payment.test.mjs: exact public paths, no token, legacy response differences and no invented receipts                                   |
| POST P/submit-trigger                    | `publicPayment.submit(input)`                            | payment.test.mjs: exact public paths, no token, legacy response differences and no invented receipts                                   |
| GET P/tx-status                          | `publicPayment.status(txHash)`                           | payment.test.mjs: exact public paths, no token, legacy response differences and no invented receipts                                   |
| GET P/subscription-allowance             | `subscription.allowance.get()`                           | subscription.test.mjs: public get/prepare/sign/submit/status, opaque intents, additive consent, input limits and no bearer forwarding  |
| POST P/subscription-allowance            | `subscription.allowance.prepare(input)`                  | subscription.test.mjs: public get/prepare/sign/submit/status, opaque intents, additive consent, input limits and no bearer forwarding  |
| POST P/subscription-allowance/submit     | `subscription.allowance.submit(input)`                   | subscription.test.mjs: public get/prepare/sign/submit/status, opaque intents, additive consent, input limits and no bearer forwarding  |
| GET P/subscription-allowance/status      | `subscription.allowance.status({intent})`                | subscription.test.mjs: public get/prepare/sign/submit/status, opaque intents, additive consent, input limits and no bearer forwarding  |
| GET P/streamer-state                     | `publicSchedule.get()`                                   | reads.test.mjs: public utility wire money/status and no bearer credentials                                                             |
| GET P/embed/activity                     | `embed.activity()`                                       | reads.test.mjs: public projection and latest snapshot contract                                                                         |
| GET P/embed/events                       | `embed.stream()`                                         | reads.test.mjs: native/chunked SSE, Unicode/CRLF, bounds, 503, abort/timeout, closure and explicit reconnect                           |
| GET /api/v1/openapi.json                 | `client.getOpenApi()`                                    | reads.test.mjs: raw document and no implicit demo token; packed declaration check                                                      |
| POST /api/v1/demo-token                  | `client.createDemoToken()`                               | reads.test.mjs: explicit opt-in, expiration/token parsing, no construction-time calls                                                  |

The [contract exclusions](contract.md#exclusions-openapi-gaps-and-hosted-verification)
remain unchanged: owner session/token management, new deployments/flows, admin,
cron, dev mutation/payroll/payout helpers, owner SSE/polling and owner QR routes
are absent from deployment SDK namespaces. Hosted URL helpers only construct
payment, allowance and embed URLs; eligibility remains the server's responsibility.

## Live verification checkpoint — 2026-10-15

The [live evidence report](../testing/2026-10-14-sdk-live-verification.md) records
packed SDK integrity, the testing host and actual app revisions, server-pinned
testnet/passphrase, controlled fixtures, Freighter consent, transaction hashes,
independent finality, state and indexed payout evidence. Its later sections
supersede historical stopped checkpoints. Source fixtures, HTTP 200 and a quote
alone are not financial-finality evidence. Credentials, signed authorization,
opaque intents and signed envelopes remain private.

- [x] Existing deployment reads: capabilities, balances/freshness, positive
      deployment-bound Swap quote, transaction lookup, filtered/paginated events,
      public snapshots and two deliberate event-stream close/reopen connections.
      Automatic network-fault recovery and heartbeat behavior were not induced.
- [x] Payments: v1 and legacy public preparation, normal wallet consent, exact
      original envelope verification, submission and matching finality/payout.
      Wallet rejection sent no transaction; signing later used the same preparation.
- [x] Funding: Schedule and Webhook discovery, exact native amount/asset consent,
      submit and original-intent reconciliation, with separate balance/event effects.
- [x] Schedule: state, pause/resume/retrieve and original-intent reconciliation;
      transient SUBMITTING correctly blocked a subsequent replacement preparation.
      The fixture was drained before its first scheduled release.
- [x] Subscription: native allowance, manual charge/payout, cancel/reactivate/final
      cancel on verified current WASMs, stable zero-approval authorization and final
      zero allowance. Reactivation granted no allowance and performed no charge.
- [x] Webhook escrow and early release: funded-pool payout, same-key original
      attempt/transaction/event replay, changed-payload conflict, before-side early
      release, independent finality and a separate drained-release refusal.
- [x] Native Webhook execution: normal Freighter authorization retained both the
      source-account entry and bounded wallet entry. Exact native 0.1 XLM receive/
      payout reached SUCCESS at ledger 5201798; same-key replay and token cleanup
      passed. The original REJECTED/PREPARATION_FAILED attempt was preserved and
      definitively shown to have no submitted hash/acceptance before a fresh
      nonce/event. This was an explicit subsequent operation, not an automatic retry.
- [x] Public OpenAPI and payment/allowance/embed surfaces were exercised with
      their source-defined authentication.
- [ ] Positive demo-token mint: testing returned 403 FORBIDDEN because its demo
      feature is disabled. The refusal and local contract tests are recorded;
      positive hosted minting remains unavailable. Do not enable shared features
      or reuse a shared financial fixture solely to remove this limitation.
- [x] Real Swap execution: separately authorized one-attempt rehearsal with a
      75 testnet XLM total declared fee ceiling completed native 0.1 XLM →
      0.0106193 USDC to the controlled wallet, SUCCESS at ledger 5202637.
      Actual declared fee was 59.3617843 XLM; net charged fee was 51.6198331 XLM
      (including 51.6169576 XLM rent). The one-attempt fee exception is consumed.
      Original-hash RPC/indexed events, exact wallet credit and six zero pipeline
      balances were verified; the new scoped token was revoked. The existing
      1-USDC trustline retains that output. Earlier unsigned refusals remain
      historical evidence; no retry or second actual Swap was used. See the
      [#982 execution evidence](../testing/2026-10-15-sdk-swap-execution-982.md).
      This one route does not establish inexpensive or universal Swap execution.
- [x] Reconcile fixture balances and revoke dedicated testing API tokens after
      their final tests. Final owner-scoped inventory confirmed zero active tokens.
      The original retired lost-wallet fixture retains its 1 XLM on-chain
      allowance; retirement does not revoke it. The controlled old-WASM fixture
      has zero allowance and retired service.
- [x] The historical #981 evidence candidate received independent review and
      [exact-head Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38673864273)
      before [merge](https://github.com/webnxt-2030/pinkraft/pull/981), followed by
      [successful post-merge CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38675573507).
- [x] The #982 real-Swap evidence received independent review and
      [exact-head Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38679818665)
      before [PR #986 merged](https://github.com/webnxt-2030/pinkraft/pull/986), then
      [post-merge CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38680674862)
      passed at `71e9326b62d18bf9366ffbf0564fdd62847c3af6`. Testing automatically
      deployed that commit and returned health `ok`, version `71e9326`.
      The metadata/docs release candidate requires its own review and exact-head CI.

The testing environment has no configured unattended Subscription scheduler.
An authorized manual cron call establishes bounded handler/charge behavior only.
Observed display balances can retain a pre-mutation value for ten seconds;
financial verification used original receipts and refreshed/direct chain reads.
No production/mainnet support or universal success across deployed contract
versions follows from these isolated testnet workflows.

## Publication gate — separately authorized

Follow [the release policy](../releasing.md). Preparing these steps does not
approve creating the scope, tagging, publishing, deploying or promoting.

- [x] Complete the bounded authorized testnet evidence, including real Swap
      execution. Positive hosted demo mint, unattended scheduling, general
      production support and inexpensive/universal Swap execution remain explicit
      limitations; this candidate makes no positive support claim for them.
- [ ] Record independent review and successful full Node/Rust CI for the exact
      candidate; retain artifact evidence and repeat checks if code changes.
- [x] Verify the supplied publisher account `saltshin` and ownership of npm
      `@paiflow` scope. No npm authentication or access settings were changed.
      Registry installation remains prospective until publication is confirmed.
- [x] Prepare first-beta `0.1.0` metadata and a dated 2026-10-15 SDK changelog
      entry; this checklist records the candidate as unpublished pending approval.
      Document API-major,
      runtime compatibility and absence of migrations. Packed README/changelog
      remain valid after publication; approval/status stays in this checklist.
      Reconcile the date/status
      with the actual publication day if approval occurs later.
- [ ] Rebuild and validate the final tarball, recording its exact integrity after
      metadata/docs changes; obtain independent final-candidate review and CI.
- [ ] Prepare annotated tag `sdk-js-v0.1.0` on the final reviewed release commit;
      create it only after release approval. No app tag/version bump is implied.
- [ ] Publish exactly the approved tarball using the authorized publisher workflow;
      capture registry version/integrity and validate a clean registry consumer.
      Never move/reuse the tag or overwrite a published version.
- [ ] Record deployment/promotion only if separately requested and authorized;
      publishing this client package does not deploy or upgrade the backend/contracts.
