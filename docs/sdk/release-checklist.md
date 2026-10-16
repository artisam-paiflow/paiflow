# SDK beta validation and release checklist

## Beta 0.2.0 — release preparation, 2026-10-16

`@paiflow/sdk@0.2.0` is the current **release candidate**, pending independent
review, exact-head CI, merge, SDK tagging and npm publication. The user authorized
this release separately from the completed first beta below. No `0.2.0` publication
or production backend promotion is claimed by this preparation record.

### Identity and compatibility

- Prepare from current `develop` baseline
  `ecb58243c839a49c23ec4d785c77d3838a92c99c` (developer-token work integrated by
  [PR #1042](https://github.com/webnxt-2030/pinkraft/pull/1042)). Release-preparation
  PRs target `develop`; SDK and app versions advance independently.
- Package `@paiflow/sdk@0.2.0`; planned annotated tag `sdk-js-v0.2.0` and GitHub
  prerelease. Package `publishConfig` remains public with npm dist-tag `beta`.
  Current published `0.1.0` remains the previous beta. Publication must move
  `beta` to `0.2.0` while preserving `latest` at `0.1.0`; plain unversioned npm
  installation must not be represented as selecting this new beta.
- Compared with `sdk-js-v0.1.0`, add `pfd_` developer credentials, typed
  `client.deployments.list/pages`, selected-scope integration examples and
  credential redaction in response metadata/error keys. Existing `pfk_`
  integrations remain compatible; no consumer migration is required.
- API remains `/api/v1`; the developer-token/discovery additions require a backend
  implementing OpenAPI revision `1.1.0`. Owner-session token management remains
  outside the SDK. Wallet signatures and webhook secrets remain separate.
- Node `>=22.22.2 <23`, ESM with TypeScript declarations and zero runtime
  dependencies remain unchanged. This preparation changes package metadata and
  maintained documentation only; it adds no SDK runtime/API behavior, root app
  version, dependencies or migrations.
- [Integrated local verification](../verification/developer-tokens-2026-10-16.md)
  and [bounded hosted testing evidence](../verification/developer-tokens-hosted-verification-2026-10-16.md)
  establish their exact documented candidates and testnet scope, using branch-built
  artifacts that still carried `0.1.0` metadata. They are historical evidence,
  not registry `0.2.0` validation or a production/mainnet availability claim.

Packaged documentation describes version capabilities without temporal publication
claims; the evolving availability record stays in this repository checklist.

### Preparation validation

- [x] SDK source/declaration typecheck: `pnpm sdk:typecheck`.
- [x] SDK built-package tests: `pnpm sdk:test` — 193 passed.
- [x] `pnpm sdk:test:package` — clean offline tarball consumer, declarations/ESM
      exports, file allowlist, 22 developer-discovery cases and compiled examples
      passed, including explicit selection and separate wallet/receipt gates.
- [x] Repository TypeScript: `pnpm typecheck`.
- [x] `pnpm audit` passed with the existing single ignored low advisory under
      repository policy ([#753](https://github.com/webnxt-2030/pinkraft/issues/753));
      no new dependency or advisory exception was added.
- [ ] Independent source/artifact review and exact-head/postmerge CI.
- [ ] Final retained archive identity and independent registry verification.

The SDK subprocess checks required execution outside the restricted sandbox;
those complete checks passed without changing runtime or tests. Initial sandboxed
child-process failures are not counted as successful validation. Archive hashes
and contents must be retained for the final reviewed bytes, following the steps
below, rather than copying the historical `0.1.0` archive identity.

### Publication SOP for this beta

1. Review the release PR and pass its required exact-head Node/Rust CI. Merge into
   `develop`, verify the reviewed SDK tree is unchanged and pass postmerge checks.
2. Build and validate the final package; retain its allowlisted archive, file
   listing, SHA-256 and npm integrity. Independently install that exact archive
   into a clean ESM/TypeScript consumer. Never substitute an unreviewed rebuild.
3. Verify the publisher is an authorized `@paiflow` owner using the normal npm
   authentication flow. Never copy credentials into files, chat or logs. Check
   `0.2.0` is absent and record existing dist-tags before publication.
4. Create/push annotated `sdk-js-v0.2.0` on the reviewed merge and publish GitHub
   prerelease notes from the SDK changelog. Verify annotation and peeled commit.
   Package README links use this versioned tag; do not publish before it exists.
5. Publish the approved archive once, explicitly using `--access public --tag beta`
   and `--ignore-scripts` because its build/artifact checks are already complete.
   This is an SDK publication, not an app release, backend deployment or contract
   upgrade. Do not retag `latest` or overwrite/unpublish an existing version.
6. Verify registry version, `beta=0.2.0`, unchanged `latest=0.1.0` and published
   integrity. Download independently, compare SHA-256/files with the retained
   archive, then run clean registry ESM/declaration and developer-token smoke
   checks without live financial writes. Record actual results, merge/tag/archive
   identities and CI/release links; retain any limitations honestly.

After publication, exact-version install is `npm install @paiflow/sdk@0.2.0`;
`npm install @paiflow/sdk@beta` follows the moving beta tag. Both are pending until
the registry verification above succeeds. If authentication or publication is
blocked, report the concrete blocker without claiming a completed release.

## Historical first beta 0.1.0 — published 2026-10-15

Local validation for [#964](https://github.com/webnxt-2030/pinkraft/issues/964)
began on 2026-10-13. The user separately approved the first-beta release on
2026-10-15; **`@paiflow/sdk@0.1.0` is published**, with its annotated SDK tag,
GitHub prerelease, exact-candidate/postmerge CI and clean registry consumer verified.
Bounded [initial live evidence](../testing/2026-10-14-sdk-live-verification.md),
[real-Swap evidence](../testing/2026-10-15-sdk-swap-execution-982.md) and the
[current broader-testing checkpoint](../testing/2026-10-15-sdk-broader-testing.md)
record distinct completed checks and remaining limits. Historical hackathon
evidence does not establish this SDK's live support.

## Release identity and compatibility

- Package: `@paiflow/sdk@0.1.0`, public first-beta publication dated 2026-10-15.
  SDK and app versions advance independently.
- Reviewed release candidate: `d42af1221da8e74995c3ccfbc1842dd2e372898e`;
  [PR #987](https://github.com/webnxt-2030/pinkraft/pull/987) merged into testing at
  `116a4d77b5d06c005581063a1ef3dd843abcc77f`, with an identical reviewed Git tree.
  The release changed metadata/documentation; SDK runtime, tests, scripts and
  dependencies remained unchanged. All 18 distributed JS/declaration files
  matched the original live-tested consumer bytes.
- Published archive integrity:
  `sha512-DueOJNgNzLVSHVSHFDbwGlm6QjVTFAm7vfU3zBPSFgAmJWevPRyfvkDk+C7zgcRm1ggRjDnGUr6wp2B5tO/ISw==`;
  SHA256 `b14c793ca4d49d842e2d7a96ec2945a7b6b8d2d1ccab503ee1b925f77281f242`.
  Independent registry download matched the approved retained archive; a fresh
  registry consumer passed ESM/declaration, exact string-amount and export checks.
- Annotated tag `sdk-js-v0.1.0`: object
  `9e29978a9d6368fa93511ffd36bdc31cca39ff05`, pointing to the merge above;
  [GitHub prerelease](https://github.com/webnxt-2030/pinkraft/releases/tag/sdk-js-v0.1.0).
- Publisher `saltshin` was verified as an owner of npm `@paiflow`; publication
  completed once through the explicitly approved workflow. Requested tag `beta`
  and registry-added `latest` both point to `0.1.0`. One attempt to remove `latest`
  returned HTTP 400 and left both tags unchanged; beta-only tagging was not
  achieved. See the matching [npm registry behavior report](https://github.com/npm/cli/issues/8490).
  No unpublish, replacement version or further tag retry was used.
- API: `/api/v1` plus the explicitly listed unversioned public/Webhook routes in
  [the contract](contract.md). The SDK release added no backend routes or behavior.
  Later testing backend fee-guard work is separately recorded in the broader report.
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
- `pnpm typecheck`: repository TypeScript passed for the release candidate. Its
  backend source was unchanged; the later fee guard has separate exact-head CI.
- `pnpm audit`: passes; one existing ignored low advisory, governed by root
  `pnpm.auditConfig.ignoreGhsas` and [#753](https://github.com/webnxt-2030/pinkraft/issues/753).
  This is not a claim of zero advisories.
- Existing API fixture checks cover OpenAPI, route coverage, funding routes,
  Schedule routes, Subscription controls and execute envelope validation.
  Six files / 185 tests passed. The final reviewed release candidate and its
  testing merge both passed full Node/Rust CI, recorded below.

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
      That historical checkpoint did not induce network faults or heartbeat behavior.
      Later published-SDK body-fault, explicit-reopen, heartbeat, timeout and cleanup
      checks passed with the limits in the [broader report](../testing/2026-10-15-sdk-broader-testing.md);
      no automatic reconnect or lossless replay is claimed.
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
- [x] Broader Subscription fee-safety check: unsigned charge preparation at ledger
      5205475 quoted 426086882 fee stroops (42.6086882 XLM), so the reviewed
      preflight stopped before any manual cron POST. No new charge/payout was
      established. Original cancellation `ca982e3a…` reached SUCCESS at ledger
      5205493, net fee 6602 stroops, cancelled state true and allowance zero;
      its scoped API token was revoked at 07:57:51.780 UTC. See the
      [broader evidence](../testing/2026-10-15-sdk-broader-testing.md).
- [x] Broader cancellation-prevention check: one later manual cron POST on the
      cancelled, never-charged fixture skipped one, charged none and submitted no
      financial transaction. On-chain next charge stayed at its original start;
      cancelled state/zero allowance remained. Durable proof at 08:03:33.017 UTC
      showed MANUAL mode, next/last charge null, exclusion from global due work
      and zero unresolved work. This proves prevention of the first unpaid charge,
      not positive payout, quiet-after-paid or next-period charging.
- [x] Broader Schedule funding: original `880153dd…` reached SUCCESS at ledger
      5205512, holding 0.2 native XLM with claimed amount zero, net fee 645059
      stroops. A funded read-only refund quote at ledger 5205522 was 11341 fee
      stroops and required no restoration; it submitted no refund.
- [x] Broader first-due Schedule fee-safety refusal: unsigned claim at ledger
      5205617 quoted 272468293 fee stroops (27.2468293 XLM), no restoration,
      so the 1 XLM bound refused it before cron POST/signing/submission.
      No successful scheduled payout was established or fee exception reused.
- [x] Broader Schedule direct refund: new authenticated cleanup hash `426e5abe…`
      reached SUCCESS at ledger 5205755, net fee 6435 stroops; exact same-hash
      native transfer returned the full 0.2 XLM and direct contract balance was zero.
      The private helper's earlier no-session attempt was definitively not admitted
      before the new owner-authenticated operation; original HTTP status was not
      retained, and a separate diagnostic 401 is not that original result.
      Direct cancel is separate from SDK `schedule.retrieve` coverage and does
      not prove a successful scheduled payout.
- [x] Supported Schedule owner retirement reached RETIRED with no blocker;
      native/USDC balances zero, API token revoked and job excluded from global
      due work. This is separate from draining funds, contract pause state or
      successful scheduled payout.
- [x] Final broader cleanup inventory at 08:21:12.465 UTC on `a5bd498e…` showed
      zero active API tokens across the dedicated owner, zero globally due
      Subscription candidates/Streamer jobs and zero unresolved work. Positive
      Subscription charging (42.6086882 XLM estimate) and first Schedule payout
      (27.2468293 XLM estimate) remain fee-blocked by the unchanged 1 XLM bound;
      their preflights made no POST/signature/submission. This is not an
      all-positive testing result. See the
      [broader report](../testing/2026-10-15-sdk-broader-testing.md) for exact scope.
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
- [x] Positive demo-credential issuance: the user separately authorized temporary
      demo API enablement on the designated controlled fixture. Two explicit SDK
      issuances returned 201, with intended-deployment capabilities 200 and another
      controlled deployment 401. A distinct token was revoked through the supported
      owner route and rejected before expiry. Both demo keys were restored to their
      exact prior absence; a subsequent SDK issuance probe returned 403 with no
      credential created. This is credential issuance, not asset minting.
- [x] Actual demo-token expiry: after the real 08:16:18.761 UTC expiry, fresh DB
      proof at 08:16:48.230 confirmed the original row unrevoked and owner/service
      active; exactly one SDK request returned 401 at 08:16:49.044. No fake clock,
      server TTL change, replacement credential or DB mutation was used.
- [x] Final demo-row cleanup: the original expired token was revoked through the
      supported owner route at 08:17:53.050 UTC. Final inventory at 08:17:57.249
      confirmed both new demo rows revoked, zero active dedicated-fixture tokens
      and no unexpected new demo/owner rows. Fresh configured/runtime proof
      confirmed both demo keys restored to exact prior absence on source
      `a5bd498e…`; baseline rows were protected. See the
      [broader checkpoint](../testing/2026-10-15-sdk-broader-testing.md).
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
- [x] Historical #982 cleanup reconciled fixture balances and revoked its dedicated
      testing tokens; its final owner-scoped inventory confirmed zero active tokens.
      The later demo-expiry experiment also completed its separately verified
      row cleanup, recorded above and in the broader checkpoint.
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
      The later metadata/docs release candidate also received its own independent
      review and exact-head/postmerge CI, recorded below.

The testing environment has no configured unattended Subscription scheduler.
An authorized manual cron call establishes bounded handler/charge behavior only.
Observed display balances can retain a pre-mutation value for ten seconds;
financial verification used original receipts and refreshed/direct chain reads.
No production/mainnet support or universal success across deployed contract
versions follows from these isolated testnet workflows.

## Publication record — completed with explicit approval

The user separately authorized merge, annotated tag and public beta publication
on 2026-10-15 under [the release policy](../releasing.md). This completed approval
does not authorize another release, tag mutation, publication, financial write or
production/mainnet promotion.

- [x] Complete the bounded authorized testnet evidence, including the separately
      approved real Swap. Unattended scheduling, general production support and
      inexpensive/universal Swap execution remain explicit limits. Later positive
      demo issuance, actual expiry and final row cleanup are documented separately
      in the broader checkpoint.
- [x] Independent final source and artifact review passed. Exact release candidate
      [full Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38690707242)
      passed at `d42af1221da8e74995c3ccfbc1842dd2e372898e`;
      [postmerge Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38691870727)
      passed at `116a4d77b5d06c005581063a1ef3dd843abcc77f`.
- [x] Publisher/scope ownership verified; the authorized browser confirmation
      completed for the one publication. No credentials are recorded here.
- [x] First-beta metadata and dated SDK changelog prepared; API-major/runtime
      compatibility and absence of migrations documented. Packed package files
      remain unchanged during this post-publication checklist reconciliation.
- [x] Final tarball rebuilt/validated and independently audited: 22 allowlisted
      regular files, no bundled/runtime dependencies or credential files; exact
      published integrity and unchanged runtime bytes are recorded above.
- [x] Annotated `sdk-js-v0.1.0` tag created and pushed on the reviewed merge;
      exact remote annotation/peeled commit independently verified. No app tag or
      app version bump was implied.
- [x] Approved tarball published exactly once. Public registry version/integrity,
      downloaded archive, all installed files, clean ESM import and strict
      TypeScript declaration consumer were independently verified. The observed
      `latest`/`beta` tag limitation is explicit above; no version was overwritten.
- [x] Normal testing deployment `83a3f5c4-31ec-4d09-8c24-5d6a91b263ed` reached
      SUCCESS at release merge `116a4d77…`; health was 200/ok, version `116a4d7`.
      Later testing-only fee-guard deployment and CI are tracked in the
      [broader report](../testing/2026-10-15-sdk-broader-testing.md).

Publishing this client package does not itself deploy or upgrade a backend or
contract. No production/mainnet promotion is established by these checks.
