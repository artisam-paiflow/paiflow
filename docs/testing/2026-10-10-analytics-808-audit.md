# Issue #808 remaining-work audit — 10 October 2026

Read-only audit; no app changes, pushes, deployments, configuration changes,
account reclassification, DB mutations, or test transactions. E2E remains paused.
This is a dated audit before the subsequent runtime check and dashboard update.
See [runtime verification](2026-10-10-analytics-runtime-readonly.md) and
[beta dashboard update](2026-10-10-posthog-beta-dashboard.md) for resolved findings.

## Source and evidence

- [#808](https://github.com/webnxt-2030/pinkraft/issues/808) remains open; all eight
  acceptance checkboxes remain unchecked. Read current body and all three comments.
- Examined fetched `origin/staging` at `b945e6aaa5bd426f2b4ee16c1e9e5565f2d14e17`.
  Root checkout is the older `docs/hackathon-participant-updates`; do not assess
  implementation from its checked-out application files.
- `origin/hackathon-staging` at `428ebd48` differs from staging only in six
  showcase/feedback documentation assets, with no additional analytics code.
- [Staging CI](https://github.com/webnxt-2030/pinkraft/actions/runs/37908793259)
  passed on `b945e6aa`. Inspected existing tests and previous migration/test evidence;
  no new tests were run against any DB.
- [#812](https://github.com/webnxt-2030/pinkraft/pull/812) supplies the main
  implementation. [#831](https://github.com/webnxt-2030/pinkraft/pull/831) supplies
  wallet cancellation classification. [#827](https://github.com/webnxt-2030/pinkraft/pull/827)
  supplies scoped deployment recovery rehearsal support.
- Archived local memory records additional 6–7 October hosted checks after the
  final issue comment. They are historical evidence summaries, not fresh beta
  observations. Referenced temporary JSON evidence was not found during this audit.
  Do not repeat already completed rehearsals solely because issue comments lag.

## Acceptance assessment

| #   | Criterion                                                    | Implemented / previous evidence                                                                                                                                                                                                                                                                                                                                                                       | Remaining                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Safe approved controls, excluded sensitive capture           | Selector allowlist, route normalization, full SDK-envelope rebuild, shared dead/rage click filter; adversarial SDK/text/URL/ancestor/deep tests. Issue comment verifies anonymous browser. Archived memory records authenticated account/password/address-book/admin/off-ramp and credential checks.                                                                                                  | Verify beta deployment and remaining actual clipboard/screen variants and bank-recipient cases where available; preserve evidence. Off-ramp is disabled and must remain so.                                                                                                                                                                                              |
| 2   | Explicit events, safe errors and context; replay off         | Browser/server event/property gates, audience/network/env/host/version context, structured diagnostics, replay off, GeoIP disable/IP null. Plain Wallets Kit object cancellation fixed by #831. Archived memory records successful desktop Freighter deploy/payment rejection analytics and retry checks.                                                                                             | Real mobile WalletConnect cancellation/retry is explicitly deferred. Confirm current beta project flags and fresh ingestion properties rather than treating previous environment settings as current.                                                                                                                                                                    |
| 3   | Durable wallet acknowledgement, retries and deduplication    | Strict schema, rate limits, session assertion, atomic record + outbox, stable connection ID, acknowledged response check, session-isolated bounded retry queue. DB-backed concurrency/rollback and browser retry/session tests exist.                                                                                                                                                                 | Live interrupted delivery and invalid/non-OK acknowledgement retry, for anonymous and classified callers; compare durable connection and business event once. Source alone does not prove hosted browser delivery.                                                                                                                                                       |
| 4   | All supported signed submissions attributable with outcomes  | Deploy inserts transaction inside claim transaction; trigger/invoke/allowance record before send; partner execute/payout common `submitPreparedDeposit` records API token and actual source separately. Lifecycle RECEIVED/ACCEPTED/UNRESOLVED/REJECTED/CONFIRMED/FAILED with revisions/timestamps/ledger/codes. Unsigned cancellation is not successful activity.                                    | Live invocation/partner API, genuine chain-failure and network-interruption rehearsals remain recorded as pending. Ordinary/UI payment and deploy success have historical evidence.                                                                                                                                                                                      |
| 5   | Server recovery, scheduling, deduplication and no regression | Cron secret guard, Redis lease, bounded conditional claims and RPC deadlines, shared deploy setup; stale observations cannot undo later acceptance/finality. Final issue comment proves pending-payment cron recovery. Archived memory additionally records successful pending-deployment recovery and cleared rehearsal settings.                                                                    | Current beta scheduler/cadence/auth/outbox-health read-only confirmation. Browser disappearance before setup and crash between confirmation/setup/audit remain unproven limits; do not claim complete crash atomicity. Scheduler UI was not inspected historically.                                                                                                      |
| 6   | Four populations and server classification                   | DB enums, server lookup, immutable event attribution, explicit sandbox, required admin audience selector/schema; API owner-account versus signer separation.                                                                                                                                                                                                                                          | Concrete provisioning gap: tester seed SQL and new admin/judge seed rows omit audience and silently default UNCLASSIFIED. Future provisioning should make a deliberate choice. Test user currently UNCLASSIFIED must become INTERNAL before E2E; audit did not change it. Classified EXTERNAL/SANDBOX journeys still need evidence; empty cohorts do not prove adoption. |
| 7   | Reproducible DB exports and PostHog journeys                 | Separate `usage-metrics-v2` generator/schema/query, cutover and network/audience/window bounds, latest outcome revisions, separate addresses/accounts/flows/deployments/executions. Dashboard definitions include activation, first success, retention, feature adoption, friction/recovery denominators. Archived memory records live 19-panel dashboard installation and DB/PostHog reconciliation. | Read existing live dashboard and beta cutover, verify it targets current environment/host and query definitions still match export. Observe classified cohorts and retention over time; do not present definitions/empty insights as observed adoption.                                                                                                                  |
| 8   | Migration/tests/typecheck/docs and post-rollout audit        | Future-only migration and indexes; revision migration; schema/idempotency/transition/real-DB/actual SDK tests. #812 records upgrade validation/full suite/CI; current staging CI passes. Tracking/privacy documentation exists. Previous rollout audit recorded.                                                                                                                                      | Reconcile stale #808 comments/checklist/runbook/dashboard-installation wording with completed evidence; record current beta read-only audit. No historical repair.                                                                                                                                                                                                       |

## Concrete source gap

The admin creation endpoint already requires `analyticsAudience`:
`lib/analytics/account-schema.ts:12`, `app/api/admin/users/route.ts:54`, and
`components/admin/user-list.tsx:104`. However,
`lib/auth/tester-seed-sql.ts:45` and `:51` generate new users without an audience,
and `prisma/seed.ts:36` / `:59` do the same for new seeded admins/judges.
`tests/unit/auth/tester-seed-sql.test.ts:69` currently expects the old column list.
This falls short of the issue's deliberate new-account provisioning rule.
It conservatively puts those accounts in UNCLASSIFIED; it does not inflate EXTERNAL.
Update future creation only, choose/validate audience explicitly, and keep existing
users' labels unchanged. No new DB migration appears necessary for that change.

Password registration also relies on UNCLASSIFIED by default
(`app/api/auth/register/route.ts:46`); public registration is disabled in current
beta context. Explicitly document its intended classification when enabled.
Google signup deliberately creates EXTERNAL in `lib/auth/google.ts:216`, and
sandbox signup explicitly creates SANDBOX in `app/api/auth/sandbox/route.ts:73`.

## Historical completion that must not be called unfinished

The final [issue comment](https://github.com/webnxt-2030/pinkraft/issues/808#issuecomment-6010442062)
closes pending-payment recovery. Archived memory additionally records:

- Deployment recovery through scheduled cron, confirmed revision 2, stable setup,
  one final outbox/receipt, and subsequent rehearsal settings cleared.
- Desktop Freighter deploy/payment cancellation analytics correctly user_rejected,
  one error_shown per rejection and no submit/status polling/signed-tx records.
- Authenticated sensitive-surface checks with intercepted analytics.
- PostHog project 610680 dashboard 2175078, 19 panels, explicit cutover
  `2026-10-06T01:58:01.543Z`, existing historical dashboards retained.

These are recorded prior completions on hackathon-testing. Issue comments, the
runbook's pending wording, and the unpublished manual verification checklist lag
those records. They need durable reconciliation/current-environment corroboration,
not assumptions that implementation or initial installation never happened.

## Recommended order

1. Confirm beta runtime/cutover/migrations, actual scheduled authenticated cadence,
   due outcomes/outbox backlog, project privacy flags and existing dashboard scope,
   without invoking jobs or changing settings. Mark the one E2E account INTERNAL
   through an authorized admin before testing.
2. Address the narrow future provisioning omission and add meaningful validation
   coverage; no historical account relabeling.
3. Resume sequential live wallet-delivery, invocation/API, rejection/failure and
   interruption coverage with fresh DB/PostHog comparisons. Remaining classified
   cohort tests need separate scope because current E2E authorization permits only
   one INTERNAL user. Real mobile tests remain deferred.
4. Consolidate existing and fresh evidence into #808 acceptance status and tracking
   docs when authorized. Retention needs elapsed observation, not a one-session pass.

No PostHog/Railway connector was available in this audit's tool inventory, and
no credentials were inspected to reach those systems. Consequently this audit
does not independently certify current hosted DB, PostHog or scheduler state.
