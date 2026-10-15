# SDK beta validation and release checklist

Local validation for [#964](https://github.com/webnxt-2030/pinkraft/issues/964)
began on 2026-10-13; the live checkpoint below is dated 2026-10-15. This candidate
is **unreleased**. Bounded, separately authorized testnet workflows now have
[SDK live evidence](../testing/2026-10-14-sdk-live-verification.md); remaining
limitations, independent final-candidate review and exact-head CI remain separate
gates. Historical hackathon evidence does not establish this SDK's live support.
No release tag or npm publication is authorized by this checklist.

## Candidate identity and compatibility

- Package: `@paiflow/sdk`, starting metadata version `0.1.0`; no historical release
  date or npm availability is implied. SDK and app versions advance independently.
- Source baseline: `testing` commit `6478bd0459cd840f3bd71c7045e3fb020946011f`,
  after the SDK docs/examples PR. The final candidate's full commit and exact-head
  CI/review evidence must be recorded in its PR before merge; a merge does not
  identify the app revision running on a hosted environment.
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
- [ ] Real Swap execution remains unverified. A normal wallet-signed trustline
      for the exact testnet Circle USDC asset succeeded at ledger 5201761, with a
      1 USDC receiving limit and 0.5 XLM reserve. It remains open with zero USDC.
      Two independent unsigned simulations quoted 590692710 and 590802880 fee
      stroops (about 59 XLM), exceeding the reviewed 1 XLM ceiling. The guard
      remained intact; no Swap execution was signed/submitted and no fee increase
      was authorized. A positive quote proves an estimate, not execution; Swap
      quoting adds no separate execution HTTP row to the 42-operation matrix.
- [x] Reconcile fixture balances and revoke dedicated testing API tokens after
      their final tests. Final owner-scoped inventory confirmed zero active tokens.
      The original retired lost-wallet fixture retains its 1 XLM on-chain
      allowance; retirement does not revoke it. The controlled old-WASM fixture
      has zero allowance and retired service.
- [ ] Complete final independent evidence/candidate review and exact-head CI before
      claiming the verification candidate ready to merge.

The testing environment has no configured unattended Subscription scheduler.
An authorized manual cron call establishes bounded handler/charge behavior only.
Observed display balances can retain a pre-mutation value for ten seconds;
financial verification used original receipts and refreshed/direct chain reads.
No production/mainnet support or universal success across deployed contract
versions follows from these isolated testnet workflows.

## Publication gate — separately authorized

Follow [the release policy](../releasing.md). Preparing these steps does not
approve creating the scope, tagging, publishing, deploying or promoting.

- [ ] Complete live evidence above and resolve any release-blocking findings.
- [ ] Record independent review and successful full Node/Rust CI for the exact
      candidate; retain artifact evidence and repeat checks if code changes.
- [ ] With explicit authorization, establish/verify ownership of npm `@paiflow`
      scope and intended publisher access. Package-name availability alone is
      not proof of ownership; no registry install command is claimed to work yet.
- [ ] Confirm first beta `0.1.0`, move chosen SDK `Unreleased` changes into a dated
      SDK entry using the actual release date, and rebuild/validate the final tarball.
      Keep API-major/runtime compatibility and migrations in the release notes.
- [ ] Prepare annotated tag `sdk-js-v0.1.0` on the final reviewed release commit;
      create it only after release approval. No app tag/version bump is implied.
- [ ] Publish exactly the approved tarball using the authorized publisher workflow;
      capture registry version/integrity and validate a clean registry consumer.
      Never move/reuse the tag or overwrite a published version.
- [ ] Record deployment/promotion only if separately requested and authorized;
      publishing this client package does not deploy or upgrade the backend/contracts.
