# SDK beta validation and release checklist

Local validation for [#964](https://github.com/webnxt-2030/pinkraft/issues/964),
2026-10-13. This candidate is **unreleased**. Local preparation is complete;
independent exact-commit review, full CI and live verification are separate gates.
No hosted requests, transactions, deployment, release tags or publication were
performed by this validation. The existing hackathon manual evidence does not
establish live support for this SDK candidate.

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

## Live verification gate — outstanding

There is no authorized wallet/testnet deployment, deployment token/Webhook secret,
or known hosted app commit supplied for this candidate. Do not extract credentials
from local files or reuse historical evidence to fill these gaps. Source schemas,
fixtures, a read-only health response and HTTP 200 cannot complete this gate.
[#964](https://github.com/webnxt-2030/pinkraft/issues/964) remains outstanding for
live evidence; use the [manual verification queue](../hackathon/manual-verifications.md)
and individual API funding/Schedule/Subscription guides for exact expectations.

For each applicable workflow, record the package commit and tarball integrity,
hosted app commit/environment, server-returned testnet/passphrase, deployment/node
IDs, publicly shareable wallet address, consent outcome, request/history IDs,
transaction hash, final ledger/status, before/after contract state and matching
indexed events. Never include secrets, opaque signed intents/auth or signed XDR.

- [ ] Existing deployment reads: capabilities, balances/freshness, quote, tx lookup,
      filtered paginated event recovery and public snapshots/stream reconnection.
- [ ] Payments: v1 and legacy public prepare → wallet consent → exact original
      envelope verification → submit → appropriate finality/business receipt;
      rejection/cancellation sends no transaction and uncertainty causes no rebuild.
- [ ] Funding: Schedule and Webhook discovery, exact asset/amount consent, submit
      and reconcile; record actual balance/event effects separately from funding
      receipt. Do not trigger a payout or callback merely by assuming funding succeeded.
- [ ] Schedule: state and pause/resume/retrieve, controller consent, confirmed state
      change and ledger-proven replacement/expiry handling where applicable.
- [ ] Subscription: state, cancel/reactivate and public additive allowance, including
      actual allowance revocation/grant and charge behavior under the manual queue.
      Reactivation alone grants no allowance and performs no immediate charge.
- [ ] Webhook: native authorization or funded pool as appropriate, caller-persisted
      keyed duplicate/conflict behavior, uncertain recovery and release-early
      eligibility; preserve financial state rather than equating 202 with success.
- [ ] Public utilities/hosted URLs: OpenAPI, explicitly authorized demo token mint,
      payment/allowance/embed availability and source-defined authentication.

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
