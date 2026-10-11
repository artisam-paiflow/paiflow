# Analytics #808 — implementation and verification status

Updated 10 October 2026. [Issue #808](https://github.com/webnxt-2030/pinkraft/issues/808)
remains open. Implementation, historical execution, and current deployment
verification are separate evidence levels. An unchecked umbrella criterion does
not mean none of its constituent work is complete.

## Implemented

[#812](https://github.com/webnxt-2030/pinkraft/pull/812) implements capture
allowlists, server-controlled audiences, durable wallet connections, transaction
outcomes, revision-safe reconciliation/outbox delivery, and future-only reports.
[#831](https://github.com/webnxt-2030/pinkraft/pull/831) fixes cancellation
classification for plain wallet error objects. [#827](https://github.com/webnxt-2030/pinkraft/pull/827)
adds deployment recovery rehearsal support. These changes are present in the
examined staging commit `b945e6aa`; its CI passed. Code and CI do not prove live
collection or scheduler configuration.

## Historical checks completed

- **Pending-payment recovery, 6 October:** the scheduled job advanced an accepted
  payment to confirmed, revision 2; its authoritative confirmation arrived once.
  [Durable issue evidence](https://github.com/webnxt-2030/pinkraft/issues/808#issuecomment-6010442062).
- **Pending-deployment recovery, 6 October:** prior local verification records
  scheduled confirmation, stable deployment setup, one final outcome/delivery,
  and cleared rehearsal configuration. Earlier runbook wording saying the initial
  live rehearsal remains pending is superseded by this recorded result.
- **Desktop Freighter deployment/payment cancellation, 7 October:** prior local
  verification records four signing failures classified `user_rejected`, one
  matching `error_shown` each, and no submit/status-poll/signed-transaction records.
  The earlier desktop-analytics pending checklist is superseded. Wallet/browser
  versions were not independently confirmed.
- **Authenticated sensitive surfaces:** prior local verification records approved
  positive controls and intercepted account/password/address-book/admin/off-ramp
  and API credential surfaces without the tested sensitive capture; rage-click
  filtering passed. Actual clipboard/screen variants and bank-recipient coverage
  remain incomplete. Disabled off-ramp must stay disabled.
- **Dashboard installation:** prior local verification records project 610680,
  dashboard 2175078, 19 panels, cutover `2026-10-06T01:58:01.543Z`, and preservation
  of historical dashboards. Dashboard-definition wording saying no initial live
  installation has occurred is superseded by this recorded result.

Except for the linked payment result, these historical results were recovered
from a local session record. Their referenced temporary evidence files were not
available during the 10 October audit. They are recorded prior completion, not
fresh observations of beta or fully independently recoverable evidence. Do not
repeat completed recovery rehearsals simply to repair documentation. Add durable,
sanitized corroboration when available; never publish the local memory file.

## Remaining

- Future provisioning paths: tester SQL and new admin/judge seed records omit an
  explicit audience and default to `UNCLASSIFIED`. Require a deliberate choice for
  future creation; do not infer or rewrite historical audiences.
- Beta reporting scope is resolved: a separate [19-panel beta dashboard](https://us.posthog.com/project/610680/dashboard/2194512)
  uses the beta host/environment and actual usage-v2 cutover
  `2026-10-09T09:15:39.533Z`. The historical dashboard and its insights remain
  unchanged. [Creation and verification evidence](../testing/2026-10-10-posthog-beta-dashboard.md).
- Direct external scheduler configuration inspection remains unavailable;
  current successful request cadence is observed, separately from saved settings.
- Live wallet delivery interruption, invalid/non-OK acknowledgements and retry
  deduplication; invocation/partner API attribution; chain failure and network
  interruption. Compare durable DB outcomes with delivered events.
- Real mobile WalletConnect cancellation/retry remains explicitly deferred.
- Classified external/sandbox journeys require separate authorization from the
  current one-internal-user E2E scope. Retention requires elapsed observation.
- Preserve limits: browser disappearance before deployment setup and a crash
  between confirmation/setup/audit do not have complete live crash-atomicity proof.
- Close umbrella acceptance criteria only when their remaining checks and evidence
  are complete. Historical repair/backfill and disabled-feature enablement remain
  outside scope.

This reconciliation changes documentation only. It neither runs a rehearsal nor
changes a dashboard, scheduler, account classification, database, or deployment.
The subsequently authorized beta dashboard creation is recorded separately above;
it changes reporting objects only.

## Fresh beta read-only audit — 10 October

[Operational evidence](../testing/2026-10-10-analytics-runtime-readonly.md) confirms
replay/console/heatmaps disabled and IP anonymization enabled. In 55 beta events
over the inspected 24-hour slice, no nonempty IP/current URL/elements appeared,
and every event carried GeoIP-disable. This is observed-slice evidence, not a
complete browser privacy test.

All 32 analytics deliveries were delivered; none were pending/due. The 23 business
receipts and 9 separate API-request receipts matched PostHog aggregates with unique
insert IDs. All 6 usage-v2 transactions were confirmed; no v2 transaction was due.
Historical null-tracking/outcome rows are outside v2 coverage, not its backlog.

Twelve reconciliation POSTs returned HTTP 200 about once per minute on the active
beta deployment. Production mode, a configured secret meeting the minimum length,
and the deployed guard support authenticated-success inference. Headers were not
inspected, 200 does not prove lease acquisition/work, and the external scheduler's
saved configuration was not accessible. No job was invoked by the audit.
