# API request history v1 (#847)

This future-only policy instruments the shared `v1Route` wrapper. Existing `usage-v2`
and Instawards definitions remain unchanged. The migration records an independent
`api-requests-v1` cutover; no old request history is inferred or backfilled.

## Collection and attribution

Every completed wrapped request, including UUID rejection, authentication failure,
validation, rate limits and application failures, queues one record. Endpoint paths
are templates; query strings, headers, IPs, request/response bodies, error messages,
credentials and signed envelopes are excluded. App version, environment and network
come from server configuration. Audience comes from the authenticated owner's DB
classification, with sandbox handled explicitly. Refused or unknown callers remain
unattributed even if a supplied token resembles a known credential.

`accountId` is the authenticated deployment owner, the account that owns the token's
scope. `tokenCreatorId` is the account that minted the token, which can differ.
Neither identifies the human operating a machine caller. Signer wallets come only
from `SignedTransaction`, joined by validated transaction hash and network.
Execute/payout submits link validated envelopes; status reads link only after their
scoped lookup succeeds; early releases link their returned transaction hash.
A linked hash does not imply the app accepted, submitted or confirmed it.

`x-history-request-id` is a fresh server UUID on each response and matches the
persisted record/request ID. It distinguishes HTTP retries even if a client reuses
`x-request-id`. The existing `x-request-id` behavior is preserved, but its arbitrary
client text is never copied into telemetry. Clients can explicitly associate a submit with its prepare by sending
`x-preparation-request-id` equal to the prepare response's `x-history-request-id`.
Reports accept the link only when the persisted prepare/submit records match the
authenticated account, token, deployment, network, environment and operation.
No association is inferred from sharing an account/deployment.

New request outbox events include `request_id` and nullable
`preparation_request_id`, so the same explicit link is available alongside HTTP
status and transaction outcomes. A supplied ID alone is not verified attribution;
apply the same context and operation checks when querying PostHog.

The API report's `submission_linkage` section measures verified link coverage for
authenticated execute/payout submit requests with a validated hash in the selected
window. It counts requests, including retries, rather than unique transactions.
It separates `with_preparation_id`, `verified_linked_requests`,
`missing_preparation_id` and `unmatched_preparation_id`. `linkage_coverage_percent`
is verified linked requests divided by `submitted_requests`; it is null when the
denominator is zero. A matching successful preparation may precede the report
start, but must follow cutover and be within 24 hours of the submit. Missing or
unmatched IDs are coverage gaps, not proof of abandoned payments. Existing
historical rows remain unchanged.

Duration covers wrapper entry through response preparation, before the telemetry
acknowledgement. It excludes transfer time and streaming lifetime. An HTTP 200 is
not a confirmed blockchain transaction; use the separate outcome report.

## Delivery, retention and health

One awaited Redis Lua command admits each record atomically into a sorted queue
capped at 10,000 members. Admission has a 100 ms acknowledgement deadline. Redis
failure/overflow leaves the API response intact and produces a structured warning.
An acknowledgement timeout is ambiguous: the command may have been admitted later.
The queue does not survive Redis data loss unless the deployment has durable Redis
persistence; there is no process-local fallback claiming durable delivery.

The existing authenticated, leased, every-minute `/api/cron/reconcile-transactions`
job drains at most 200 records, writes request records and PostHog outbox rows in
one database transaction, then removes committed queue members. Failure leaves
members for the next tick. Stable UUIDs make replay after a commit/removal crash
idempotent. Delivery retries can therefore create neither duplicate request rows
nor duplicate `$insert_id` values. Requests that never reach the wrapper, interrupted
handlers, and telemetry that cannot be admitted are outside guaranteed coverage.

Operational business events have their existing outbox budget. Request events use
a separate 50-event/2-second budget after business delivery, preventing request
volume from consuming the payment-event budget. This is a bounded sequential
PostHog delivery loop; batch PostgreSQL writes do not imply batch HTTP ingestion.
Request outbox backlog can grow if PostHog delivery cannot keep up; monitor its age
and queue counters. Do not claim complete dashboards while events are pending.

Request rows and their app-side analytics outbox rows retain 30 days. Each tick
removes at most 1,000 expired rows from each table using indexed queries. Cleanup is
incremental, so scheduler outages can temporarily extend retention. It does not
delete existing business events or change the PostHog project's retention settings.
Malformed queue members are discarded and counted. Raw malformed content is not
logged. Maintenance failure is reported separately from transaction reconciliation.

The cron response's `requests` fields expose admission counters (`queued`,
`overflow`), persistence failures, invalid records, pending count, oldest queue age,
request outbox count and oldest pending outbox event/attempt count. Redis admission
failures and acknowledgement timeouts are observable in structured logs, since an
unavailable Redis cannot reliably store its own failure counter. Counters are global
to this environment's Redis, not filtered reporting-window totals.

## Operator report

The detailed raw-history report below keeps its existing scope and retention.
For longer-term endpoint counts, use the [daily report](#durable-daily-aggregates).

Run with a server-only context and the intended read-only reporting database:

```sh
pnpm exec tsx --conditions=react-server scripts/api-request-report.ts \
  --start 2026-10-08T10:00:00Z --end 2026-10-09T10:00:00Z \
  --network testnet --environment beta --audience INTERNAL \
  --output /tmp/api-requests-v1.json
```

Use a start at/after the database's cutover and within its retained 30 days. The
window is `[start,end)` by request start time, at most 31 days. Counts use one UUID
per HTTP response. Output files are created exclusively with mode 0600; they
contain internal account/token/creator IDs and should stay with authorized operators.
There are no public report endpoints. Group outputs cap at 1,000 rows and report
truncation; SQL has a five-second statement timeout.

- Requests, HTTP errors and p50/p95 latency by endpoint, method, account and token.
  Error rate denominator is recorded requests; `status >= 400` is an HTTP error.
- UTC Monday weeks of calling accounts and accounts linked to confirmed activity.
  Confirmed accounts require a matching transaction caller and an attempt received
  in the window; polling someone else's transaction cannot confer their activity.
  Accounts and wallets are never labeled distinct people.
- Chain outcomes for distinct hashes linked to requests in the window, including
  confirmation duration and unresolved age. Multiple polls/submits do not multiply
  transaction counts. The transaction audience must match the selected cohort.
  Hashes without matching lifecycle records have no derived outcome. Current
  outcomes are read at report time.
- Token creation to its first **observed call in this window**, and calling tokens
  with confirmed transaction records received in the window. This is deliberately
  not claimed as lifetime-first activation.
- Repeated submit hashes, capped at 1,000 with a truncation flag. These represent
  repeated HTTP submits, not actual resend counts (`submissionRevision` records
  those separately; the outcome groups report actual resend counts from it).

Use the existing `scripts/usage-metrics-v2.ts` for broader flow/deployment/execution
adoption. It has its established network/audience scope, without a new environment
claim. The report counts explicit preparation links within 24 hours. Clients that do not
propagate the prepare response ID remain uncorrelated; missing links never prove
abandonment, and windows ending less than 24 hours ago are immature. Same-hash
failed HTTP submit → successful retry → confirmed outcome uses a 24-hour retry
window. It counts failed request records, not distinct payment intents. Cross-hash retries lack intent correlation;
shared token/deployment alone cannot prove the same failed payment was recovered.
Scheduled reporting includes off-ramp, streamer and payroll jobs due in the window on
deployments observed by requests in the selected environment/audience. Status,
attempt counts and completion lag are reported from job rows. This is a request-scoped
subset, not coverage of all subscription/timelock schedules. Complete cost
per success still needs fee/RPC coverage. These coverage gaps
remain explicit rather than inventing denominators.

## PostHog dashboard definitions

Create a separate **API requests v1** dashboard, leaving existing dashboards intact.
For every insight filter `event = api_request_completed`, `source = server`,
`tracking_version = api-requests-v1`, the selected environment/network/audience and
an explicit time window. Use `$insert_id` to verify delivery uniqueness. Reports
exclude pending/dropped telemetry; compare counts against PostgreSQL after queues
drain. Do not combine this event count with `transaction_outcome` as one activity
count.

| Insight                  | Definition                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request volume           | Event count by `endpoint`, `method`, `account_id`, `api_token_id`                                                                                       |
| HTTP error rate          | Events with `http_status >= 400` divided by all request events                                                                                          |
| Authentication failures  | Events with `http_status = 401`; unknown callers stay unclassified                                                                                      |
| Rate limiting            | Events with `http_status = 429` by endpoint/token where authenticated                                                                                   |
| Response preparation p95 | 95th percentile of `duration_ms`, by endpoint                                                                                                           |
| Weekly calling accounts  | Distinct nonempty `account_id`; separate audience cohorts                                                                                               |
| Developer activation     | First observed request followed by confirmed `transaction_outcome`, joined on authoritative `account_id` and network; report window/history limitations |
| Confirmation/recovery    | Existing outcome insights use latest `outcome_revision` per hash; HTTP errors and chain outcomes stay separate                                          |

Request events are server-authored, have no person-profile processing and preserve
original request timestamps. The event/property allowlist validates final delivery
properties. Session replay and GeoIP settings are unchanged.

## Validation and rollout

Opt-in integration checks accept only the dedicated local `issue847_test` database
on port 55487 and Redis on port 6387. They cover capacity, replay, atomic outbox
persistence, retention, real report SQL and a 200-record latency/batching sample.
Run with `API_HISTORY_TEST_DATABASE_URL` set to that disposable database. Other
unit tests cover authentication, validation, structured errors, identity isolation,
concurrent hash context, acknowledgement timeout and final event properties.

A local sample measured baseline serialization p95 0.07 ms, Redis admission p95
1.04 ms and one 200-record PostgreSQL/outbox batch at 89 ms. These are telemetry
component measurements on local services, **not hosted API p95 or an overhead SLO**.
The wrapper adds no new per-response PostgreSQL query: classification joins the
existing authentication lookup; a batch uses two inserts in one transaction.

Before closing #847, deploy/migrate the approved environment and verify its existing
cron schedule/authentication, Redis persistence, new record collection, failed
responses, attribution, queue drainage and exact-once PostHog insertion. Compare
hosted endpoint p95, PostgreSQL transaction/query load and delivery backlog over
matched before/after windows at representative load. Record traffic and versions;
local checks do not establish hosted performance or live collection. Installing
these dashboard definitions and changing PostHog retention are separate operator
steps. No historical mutation or live rollout is performed by this implementation.

## Durable daily aggregates

The `20261015130000_api_request_daily_aggregates` migration adds a separate,
identity-free aggregate store. It does not extend raw request or request-outbox
retention, change API coverage, or configure a cron in any environment.

`ApiRequestDailyAggregate` groups requests by UTC date of `occurredAt`, network,
analytics environment, audience, tracking version, normalized endpoint and method.
It preserves request/error/401/429 counts, total handler duration, min/max duration
and the most recent request timestamp. Counts and duration sums are bigint values;
reports serialize them as strings. Weighted mean duration is sum/count. No account,
token, deployment or wallet identifiers, bodies, query strings or credentials are
retained in these aggregates. Daily counts cannot recover distinct users or exact
p50/p95 latency; use the detailed raw report for those within its retention window.

An AFTER INSERT statement trigger consumes the batch of newly inserted request
rows and updates the aggregate in the same transaction. A failed aggregate update
rolls back the raw insertion, so the existing drainer leaves queue members for
retry. Raw rows are treated as immutable: deleting them for retention does not
subtract from aggregates, and editing persisted history is not a correction API.
There is no separate periodic rollup that can fall behind raw retention.

`ApiRequestAggregateReceipt` stores only each server-generated request UUID. Its
primary key prevents counting a telemetry replay twice, even if the original raw
row has already expired and the same UUID is inserted again. A fresh HTTP retry
gets a new UUID and counts as another request. These receipts and the aggregates
are retained indefinitely; the receipt ledger grows with persisted request volume.
Deleting receipts breaks replay protection and is not part of raw-history cleanup.

### Migration, backfill and coverage

The migration installs the tables and trigger and backfills retained raw rows in
one transaction. It takes a write-blocking lock on `ApiRequestLog` for that work;
size and schedule the deployment accordingly. Normal API responses do not write
this table synchronously, but telemetry persistence can wait/retry during the lock.
The new storage is maintained by the database, including inserts from older app
versions; the existing 200-record drainer and 30-day cleanup do not need new code.
Migration/application roles must be able to insert receipts and update aggregates.
A restricted custom ingestion role needs those privileges as well as raw INSERT.

Backfill cannot recreate requests already deleted. `ApiRequestDailyCoverage`
records the backfill time and a conservative coverage start: the later of the
original `api-requests-v1` cutover and 30 days before migration. Reports reject
start dates before that UTC boundary day rather than showing fabricated zeroes.
The boundary day may be partial and is flagged. Older raw rows that happen to
remain during incremental cleanup are backfilled too, but the report does not
claim their entire older period is complete.

Late arrivals update their original request date, so historical counts can change.
A current/future end date is flagged as incomplete. Queue admission failures,
missing cron processing, telemetry not yet persisted, and routes outside the v1
wrapper remain outside these counts. The coverage boundary describes preserved
persisted data; it does not certify complete capture of all API traffic.

### Daily report

```bash
DATABASE_URL="$STAGING_DATABASE_URL" pnpm analytics:api-report --daily \
  --start 2026-10-13 --end 2026-10-15 \
  --network testnet --environment beta --audience EXTERNAL \
  --output reports/api-daily.json
```

Dates are **UTC**, `YYYY-MM-DD`, with an exclusive end; they are not Philippine
calendar-day windows. Windows may span up to 3,660 days and are independent of raw
retention. Output includes overall totals, per-day totals, and up to 1,000
endpoint/method groups with a truncation flag. It does not aggregate per-day
percentiles or distinct-account totals. Queries run in a read-only repeatable-read
transaction with a five-second statement timeout and no Redis dependency.

The existing report without `--daily` is unchanged in scope. It still reads raw
rows for account/token breakdowns, p50/p95, transaction linkage, activation,
preparation/recovery analysis and scheduled jobs. The daily report is a complement,
not a superset. The snapshot command does not automatically include this report.

After deploying the migration, grant an existing reporting login SELECT only on
the new report tables (the receipt ledger is not needed for reporting):

```sql
GRANT SELECT ON TABLE
  public."ApiRequestDailyAggregate",
  public."ApiRequestDailyCoverage"
TO analytics_reader;
```

The login also needs CONNECT to the intended database and USAGE on `public`, as
with the existing read-only setup. Do not replace the application connection URL
with the analytics login.

### Local integration verification

For automatic daily exports on a dedicated Railway service, see
[daily report cron setup](daily-report-cron.md).

`tests/unit/api/request-daily-integration.test.ts` is opt-in and resets the public
schema **only** on the dedicated local database `api_daily_test` at
`127.0.0.1:55489`. It requires PostgreSQL and `psql`; set
`API_DAILY_TEST_DATABASE_URL` to that disposable database. Never point it at shared
data. It applies the prior migrations, seeds retained history, then applies the
aggregate migration to verify backfill, cleanup/replay, rollback, concurrent
inserts, UTC dates, scope and reporting after the raw retention period.
