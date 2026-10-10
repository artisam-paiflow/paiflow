# PostHog beta dashboard update — 10 October 2026

Created [Paiflow beta usage-v2 — classified future cohorts](https://us.posthog.com/project/610680/dashboard/2194512)
in project **610680**, dashboard **2194512**, with **19 independently owned insights**.
The historical [hackathon dashboard](https://us.posthog.com/project/610680/dashboard/2175078)
and its 19 insight definitions remain unchanged.

## Scope and preserved semantics

All 19 queries explicitly select `app_host=beta.app.paiflow.xyz`, `app_env=beta`,
`stellar_network=testnet`, `tracking_version=usage-v2`, and their original named
audience. The actual beta usage-v2 cutover is `2026-10-09T09:15:39.533Z`.
Dashboard reports remain live through UTC query refresh, retaining the original
submission/outcome window rules.

Copied the complete DataTable/HogQL query objects. Only hostname/cutover literals
changed, with a matching environment predicate added to every host-scoped events
source, including aliases. Population denominators, hash deduplication,
`argMax(outcome, outcome_revision)` selection, account joins, recovery maturity,
and partial retention-week rules were preserved. Tile order, default layouts,
colors, description visibility and filter overrides match the historical source.
No existing insight was shared with or moved to the beta dashboard.

The new description records observed reconciliation traffic about once per minute;
it explicitly states that saved external scheduler settings were not inspected.
Separate API-request telemetry (`api-requests-v1`, whose receipts have no host)
remains outside this usage-v2 dashboard.

## Verification

- All 19 beta SQL queries executed successfully before creation and again after
  readback. Empty/zero EXTERNAL and INTERNAL cohorts are expected for the observed
  activity; they are not query errors. Empty timing distributions are undefined,
  and incomplete retention/recovery windows retain their original qualifications.
- All 19 new insight IDs are distinct from every historical source ID. Readback
  confirms each belongs exclusively to dashboard 2194512 and exactly matches its
  reviewed beta query. The dashboard has precisely 19 panels in the source order.
- Historical dashboard definition, memberships/presentation and all 19 historical
  insight names/descriptions/queries/tags/memberships/deletion/order fields matched
  their baseline after creation. Baseline normalized definition SHA-256:
  `7634d3cc3dee7694f9e647488a2855a651f639f26beefec4722b5aa6c2fcf35d`.
- Two fresh, uncached aggregate queries used the same fixed exclusive UTC end
  **2026-10-10T15:09:20.869Z**, across all available events before that timestamp.
  All **124** grouped rows matched exactly before/after: **13,806 events**, their
  unique event UUID counts, and nonempty unique insert-ID counts were unchanged.
  Grouping used hostname, environment, tracking version, audience and event name;
  no user identities or event payloads were exported.

| Host scope                   | Events before | Events after | Unique event UUIDs before/after | Nonempty unique insert IDs before/after\* |
| ---------------------------- | ------------: | -----------: | ------------------------------: | ----------------------------------------: |
| (host absent)                |         13248 |        13248 |                           13248 |                                     12824 |
| beta.app.paiflow.xyz         |            79 |           79 |                              79 |                                        70 |
| pinkraft-prod.up.railway.app |           479 |          479 |                             479 |                                       475 |

\*Insert-ID totals here are sums of per-group distinct counts; absent IDs are
excluded. The before/after comparison checked every group, not just these sums.
The scoped beta usage-v2 business receipts still contain 6 signed events,
12 outcome revisions, and 5 acknowledged wallet connections, each with matching
nonempty unique insert-ID counts. Outcome revisions are not additional transactions.

This provides direct evidence that the inspected stored population survived this
reporting-only change. It does not establish that every possible historical
browser event was originally captured or guarantee future delivery/retention.

## Safe change boundary

Used only GET dashboard/insight reads, POST aggregate queries, POST a new dashboard,
and POST independent new insights on the official `https://us.posthog.com` API.
No event deletion/backfill, retention, project settings, capture/ingestion, identity,
cohort, DB, application, scheduler, account classification or historical-dashboard
mutation occurred. No pushes or E2E actions ran. Credentials were entered through
hidden ephemeral input, not persisted in scripts/reports, and the process exited
once verification completed.

One insight creation received HTTP 400 because its description exceeded the API's
400-character limit. The description was shortened and creation resumed within
the same dashboard; the final 19-panel count and ownership were verified.

## Insight mapping

| Panel                                          | Historical insight | Independent beta insight |
| ---------------------------------------------- | -----------------: | -----------------------: |
| [EXTERNAL] Operational totals                  |           12560170 |                 12725473 |
| [EXTERNAL] Acknowledged wallet connections     |           12560171 |                 12725474 |
| [EXTERNAL] Latest attempt lifecycle            |           12560172 |                 12725475 |
| [EXTERNAL] Structured friction                 |           12560173 |                 12725476 |
| [EXTERNAL] Feature observations                |           12560174 |                 12725477 |
| [EXTERNAL] Approved control exploration        |           12560175 |                 12725478 |
| [EXTERNAL] Observed activation by account      |           12560177 |                 12725479 |
| [EXTERNAL] Time to first observed success      |           12560178 |                 12725480 |
| [EXTERNAL] Weekly observed account retention   |           12560179 |                 12725481 |
| [EXTERNAL] Recovery after first observed error |           12560180 |                 12725483 |
| [INTERNAL] Operational totals                  |           12560181 |                 12725484 |
| [INTERNAL] Acknowledged wallet connections     |           12560182 |                 12725485 |
| [INTERNAL] Latest attempt lifecycle            |           12560183 |                 12725486 |
| [UNCLASSIFIED] Operational totals              |           12560184 |                 12725488 |
| [UNCLASSIFIED] Acknowledged wallet connections |           12560185 |                 12725489 |
| [UNCLASSIFIED] Latest attempt lifecycle        |           12560186 |                 12725490 |
| [SANDBOX] Operational totals                   |           12560187 |                 12725491 |
| [SANDBOX] Acknowledged wallet connections      |           12560188 |                 12725492 |
| [SANDBOX] Latest attempt lifecycle             |           12560189 |                 12725493 |

## API documentation

Creation fields and independent insight ownership were checked against the official
[dashboard API](https://posthog.com/docs/api/dashboards) and
[insights API](https://posthog.com/docs/api/insights). Aggregate verification uses
the official [query API](https://posthog.com/docs/api/query).

The original read-only runtime report remains a dated observation before this
update. Its reporting-scope gap is resolved by the separate beta dashboard;
remaining browser/API analytics and external scheduler-configuration checks remain.
