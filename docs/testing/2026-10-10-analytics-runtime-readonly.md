# Beta analytics runtime audit — 10 October 2026

Read-only observations at approximately 14:48–14:51 UTC. No job invocation,
settings/database writes, account changes, test transactions, pushes, or E2E
actions. Credentials were used through hidden ephemeral input and are absent
from this report and temporary scripts. The dashboard mismatch documented here
was subsequently resolved by the [beta dashboard update](2026-10-10-posthog-beta-dashboard.md).

## Runtime identity

Railway metadata maps `beta.app.paiflow.xyz` to project
`576ef2f5-16ec-4778-bdef-dca18f14d04b`, environment **staging**
`11e4c7d9-7b4c-43bd-ab93-50ff894bbb0b`, service **paiflow-app**
`78c1d697-51be-4bf4-ab21-e79b240b162c`. Active successful deployment
`dec34d07-d681-4005-9a89-44d6199ef8ac` uses commit
`b945e6aaa5bd426f2b4ee16c1e9e5565f2d14e17`, created 9 October 09:03:12 UTC.

Selective runtime reads confirm `NODE_ENV=production`, analytics environment
`beta`, canonical URL `https://beta.app.paiflow.xyz`, and Stellar **testnet**.
The cron secret is configured and meets the minimum 32-character requirement;
its value was neither printed nor retrieved. No rehearsal-named variables were
present. PostHog public project-key configuration is present.

## PostHog privacy and ingestion

Read the existing [Paiflow beta project](https://us.posthog.com/project/610680).
Current project settings:

- Session recording/replay opt-in, console capture and heatmaps: **false**.
- IP anonymization: **true**.
- Exception autocapture and web-vitals autocapture opt-in: **false**.
- Dead-click capture and performance capture opt-in: **true**.
- Autocapture opt-out: **null**; this is not a project-wide disabled setting.
- Recording domain configuration names `https://beta.app.paiflow.xyz`, but
  recording itself remains disabled.
- Plugin-config listing returned no installed configurations; do not infer a
  project-level GeoIP plugin setting from that empty list.

Source at the deployed commit disables automatic exception capture and session
recording; approved button/link click selectors and final payload rebuilding
restrict browser capture. Source evidence alone is not a fresh browser privacy
test.

A fresh, uncached PostHog aggregate over the previous 24 hours found **55 events**
with `app_host=beta.app.paiflow.xyz`: **0** with nonempty `$ip`, **0** with
nonempty `$current_url`, **0** with nonempty `$elements`, and **55** carrying
`$geoip_disable=true`. This verifies those properties in this observed slice,
not all possible future payloads or remaining sensitive-surface scenarios.

Recent usage events identify `app_env=beta`, network `testnet`, tracking version
`usage-v2`, and SANDBOX/UNCLASSIFIED populations. The same project also receives
old-host INTERNAL activity; host scoping therefore matters. No fresh beta INTERNAL
journey was observed in the inspected post-cutover aggregate. This audit did not
generate any activity or reclassify the test account.

## Concrete dashboard mismatch

The existing [19-panel dashboard](https://us.posthog.com/project/610680/dashboard/2175078)
is installed and retains its previous four-population design. All **19** current
panel queries pin:

- `app_host=pinkraft-prod.up.railway.app`;
- `stellar_network=testnet` and tracking version `usage-v2`;
- the old cutover `2026-10-06T01:58:01.543Z`;
- their named EXTERNAL/INTERNAL/UNCLASSIFIED/SANDBOX audience.

None selects `beta.app.paiflow.xyz` or explicitly filters `app_env`. The dashboard
description still says **hackathon-testing** and **reconciliation scheduling is
deferred**. It cannot report the current beta host's test results under these
definitions. Preserve this historical dashboard; a separately scoped beta
dashboard/report or an explicitly authorized scope update is needed.

The **actual beta DB cutover** is `2026-10-09T09:15:39.533Z` for `usage-v2`;
`api-requests-v1` activated at `2026-10-09T09:15:39.605Z`. Do not transplant the
old environment's October 6 cutover into beta reporting.

## Database and PostHog delivery comparison

Aggregate SQL ran inside `BEGIN READ ONLY` transactions on staging's **Postgres**
service. No row-level identities, transaction hashes, addresses or event
properties were exported.

All **32 AnalyticsDelivery rows** were delivered; pending/due counts were zero.
Counts by event/audience/host match fresh, uncached PostHog aggregate receipts
after the beta cutover:

| Event                    | Audience     | DB delivered | PostHog receipts | Unique insert IDs |
| ------------------------ | ------------ | -----------: | ---------------: | ----------------: |
| transaction_signed       | SANDBOX      |            4 |                4 |                 4 |
| transaction_signed       | UNCLASSIFIED |            2 |                2 |                 2 |
| transaction_outcome      | SANDBOX      |            8 |                8 |                 8 |
| transaction_outcome      | UNCLASSIFIED |            4 |                4 |                 4 |
| wallet_connect_succeeded | SANDBOX      |            4 |                4 |                 4 |
| wallet_connect_succeeded | UNCLASSIFIED |            1 |                1 |                 1 |

These 23 business-event receipts use `app_host=beta.app.paiflow.xyz`. The remaining
9 rows are delivered `api_request_completed` events with UNCLASSIFIED audience
and no `app_host`; PostHog shows the same 9 events with `app_env=beta`, network
`testnet`, tracking version `api-requests-v1`, and null host. API-request telemetry
uses its separate scheme and is not covered by the usage-v2 dashboard.

There are **5 durable WalletConnection rows**: 4 SANDBOX and 1 UNCLASSIFIED.
All **6 usage-v2 signed transactions** are testnet CONFIRMED; none are due for
reconciliation. There are also **162 historical testnet signed transactions**
whose outcome/tracking-version fields are null and whose next-check due count is
zero. They are outside future-only v2 coverage, not an observed v2 backlog; no
historical repair was attempted.

Receipt counts and unique insert IDs show no duplicate receipts in this slice.
This is an aggregate comparison, not a row-by-row identity join or new retry,
failure, interruption or recovery test.

## Scheduler observations and access limits

Read Railway's filtered HTTP request logs without invoking the cron endpoint.
Observed **12 POST requests**, all HTTP **200**, to the beta host's
`/api/cron/reconcile-transactions` on the active beta deployment from
**14:37:13.476 UTC through 14:48:02.067 UTC**. Adjacent request timestamps are
approximately 49–64 seconds apart, consistent with a one-minute scheduler.

The deployed handler calls `requireCronSecret` before work; runtime production
mode and a sufficiently long configured secret support the inference that these
200s passed its authentication check. Request headers/secrets were not inspected.
HTTP 200 alone does not prove each request acquired its Redis lease or did work.
The empty current DB backlog provides a separate operational observation.

Railway service cronSchedule is null; the historically recorded scheduler is an
external cron-job.org job. No cron-job.org connector/session is available here,
so its saved schedule, target, timeout, enabled state and secret-header settings
were **not directly inspected**. The logs establish current successful traffic
and cadence, not the scheduler UI's configuration or long-term reliability.

## Remaining actions

1. Scope beta reporting to the beta host/environment and its actual October 9
   cutover, preserving old-host historical reporting. No dashboard was changed.
2. Inspect cron-job.org settings if a direct configuration audit is still needed;
   current cadence/authenticated-success evidence is already available.
3. Complete the planned live UI/API analytics comparisons and privacy/retry/failure
   cases under the single INTERNAL test account. Those tests remain paused.

The orchestration agent owns issue/documentation reconciliation separately.
