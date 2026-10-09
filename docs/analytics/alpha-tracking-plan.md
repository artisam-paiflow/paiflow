# Analytics tracking plan — usage-v2

This is the future-collection policy for #808. Its implementation is in
`lib/analytics/`. Deployment, PostHog dashboard installation and live scheduler
verification are separate rollout steps; code or local tests do not establish
that collection is running on a hosted service.

The historical [alpha tracking plan](alpha-tracking-plan-v1.md) and existing
Instawards generators retain their earlier evidence definitions. They do not
define current external adoption. Existing data is accepted: no backfill,
deletions, inferred audience labels or repair of old outcomes.

## Activation and scope

`TRACKING_VERSION = usage-v2`. Migration inserts the actual UTC cutover into
`AnalyticsPolicy.activatedAt`. New wallet connections and transaction attempts
carry that version; historical signed rows have null version/outcome. Reports
must state explicit start/end instants, network and audience, and start at or
after this cutover. Rolling out to another database establishes its own timestamp.

Analytics delivery is enabled by `NEXT_PUBLIC_POSTHOG_KEY`; durable DB collection
continues without that key. `POSTHOG_HOST` is the server capture endpoint. Browser
configuration remains bundled and proxied through `/ingest`; a rebuild is required.

## Capture and privacy

Autocapture is opt-in on individual buttons/links with approved
`data-analytics-control` IDs. Current controls cover flow navigation, opening or
confirming flow creation and selecting a builder block. The catalog reserves
IDs for help and safe canvas controls, which collect nothing until an individual
control is marked. A whole panel must never be marked. Clicks on icons inside an
approved control are allowed; input/change/submit events and unrelated parents
are refused.

The SDK masks text. The final gate reconstructs each payload, retaining the
approved control ID and removing all element text, ancestor attributes, labels,
titles, URLs, form contents and unknown/deep branches. It also sanitizes
top-level and nested person-property updates (`$set`, `$set_once`, `$unset`). Only
approved profile fields survive; SDK initial URLs and campaign/referrer data do
not. The public project key is supplied from SDK initialization for ingestion.
The same gate applies to `$autocapture`, `$dead_click` and `$rageclick`.
Account/admin/address-book and
unknown routes do not produce these captures or pageviews. Explicit safe actions
such as token creation or passkey addition may still record an action without
collecting their surrounding screens. AI conversation contents are never captured.

Every explicit product event passes an event/property/value allowlist at runtime.
Builder/validation/quote events remain available. Error events retain stage,
category and allowlisted code; message text becomes a constant grouping marker.
Runtime errors contain at most eight validated static-chunk file/line/column
frames, never exception messages, function names, requests or arbitrary stacks.
User cancellation has `error_class = user_rejected`, separately from failures.
An initial root-layout error can independently fetch authoritative analytics context
and capture its originating structured diagnostic after identity synchronization.
Identity changes invalidate that fallback. Ordinary actions observed before session
initialization are dropped rather than attributed retrospectively.
Automatic raw exception capture is disabled and raw `$exception` events are refused.

Signing wallets' own public G-addresses remain deliberate traceability fields.
Recipient addresses, usernames, emails, tokens, keys, signed XDR and graph JSON
are never approved event properties. Profiles may hold only account role and the
latest/first signing wallet address. They are not proof of wallet custody.

Session recording stays disabled; snapshots and unknown SDK events are dropped.
Every delivered event sets `$geoip_disable = true` and `$ip = null`: no GeoIP
country/city/coordinates are requested. Country has no current reporting need.
Keep the PostHog project replay setting off and verify its IP-discard setting
before rollout. SDK `ip: false` is deprecated and is not an IP privacy control.
Previously collected enrichment is not deleted by this change.

## Identity and audience

Server-controlled context supplies `audience`, `account_id`, `caller_type`,
`stellar_network`, `app_env`, `app_host`, `app_version` and `tracking_version`.
The browser obtains this through a rate-limited endpoint for its current session;
properties passed to a browser track call cannot override those values.
`app_host` is the configured canonical application host, not an arbitrary URL.
Routes are normalized to known templates, without queries/fragments or free-form
segments. Browser identity is synchronized before queued events are released.
Queued actions belong to a single session generation and are discarded on logout,
account change or unresolved session state. Actions received before the initial
session is known are not retrospectively assigned to a later account. Anonymous
events explicitly set `$process_person_profile = false`; only synchronized session
accounts enable profile processing.

Account classification is independent of auth role:

- `INTERNAL` and `EXTERNAL` require an explicit organiser choice.
- `SANDBOX` follows the sandbox role and cannot be relabelled as external.
- Existing, anonymous and otherwise unknown accounts stay `UNCLASSIFIED`.
- New accounts created in the admin UI require a deliberate classification;
  provisioning tools that omit it retain the explicit unclassified default.

DB records snapshot classification at receipt. Changing a user's future
classification does not rewrite earlier records. Source address, session account
and API caller are distinct: an API token identifies its calling deployment-owner
account for operational account metrics but does not say that account signed the
transaction. Anonymous signers use a wallet ID without a PostHog person profile;
API callers use `api:<token-id>`. None of these IDs counts distinct humans.

## Durable connections and transaction outcomes

`WalletConnection` records a UUID connection ID, public address, network, provider,
surface, session account if present, audience, policy version and receipt time.
The anonymous endpoint preserves rate limits, verifies the environment's network
and asserts the request still belongs to the same session. The DB write and
outbox insert commit together; acknowledgement means the record exists. Concurrent
retries of identical input add neither rows nor business events; reusing the ID
for different data is a conflict.

The browser keeps a bounded queue of public connection metadata in session
storage, checks the acknowledgement ID, retries unsuccessful delivery every
30 seconds and resumes across reloads. Connections made during initial session
loading wait in the queue until the session resolves, retaining their connection ID and acquiring
the resolved account or explicit anonymous attribution before first delivery.
Established anonymous attribution is distinct from unresolved initialization.
Queue/storage/session failures never block payment actions. A session change
discards old pending entries to avoid attributing
them to a new account. `wallet-connection-delivery` diagnostics expose pending count
and acknowledged/retrying/session-changed/queue-full states without credentials.
Requests that never reach the server are not represented as captured connections.

`SignedTransaction` is durably written before network submission for deployment,
trigger, invocation and partner execute/payout submissions. DB failure stops the
chain call. The row contains source/signature information, session account or API
caller, network, policy, audience and a hash-idempotent lifecycle:

| Outcome    | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| RECEIVED   | Signed envelope received; network acceptance not observed yet         |
| ACCEPTED   | Network queued it or reported it as already queued                    |
| REJECTED   | RPC refused the submission; it may be retried                         |
| UNRESOLVED | Transport/finality deadline or NOT_FOUND; no final result established |
| CONFIRMED  | RPC reported chain success                                            |
| FAILED     | RPC reported chain failure                                            |

Confirmation/failure time, observed acceptance time, ledger and structured failure
code are recorded when available. A retryable rejection is not a chain failure.
`NOT_FOUND` and RPC read errors preserve a known `REJECTED` outcome and its
`RPC_REJECTED` code. An actual resend with an ambiguous RPC result may become
`UNRESOLVED`; observed acceptance or verified finality can also replace the
rejection. A real retry can replace `UNRESOLVED` with a refusal or acceptance;
previously observed acceptance is sticky, so a later send refusal cannot erase it.
Each actual send reserves a persisted submission revision first. Older refusals,
transport errors and stale reads cannot overwrite newer evidence; queued acceptance
and definitive same-hash chain finality remain authoritative even when observed late.
Status reads never supply evidence of a resend.
`CONFIRMED` and `FAILED` are terminal; compare-and-set writes prevent stale updates
from changing them. Every committed transition increments `outcome_revision` and
gets its own stable outbox ID; revisiting an outcome emits a new transition, while
repeating the same observation emits none. Dashboards select the largest revision,
so delivery order and timestamp ties cannot change the latest state. The additive
revision migration rewrites no historical outcomes or analytics events.
Prepared-but-unsigned deployments create no transaction attempt.
User wallet cancellation is an error journey event, not successful usage.

Authoritative business events are inserted into `AnalyticsDelivery` in the same DB
transaction as their record/outcome change. The outbox retries failed PostHog
responses with bounded backoff and a stable `$insert_id`; retries also retain the
original receipt/outcome event time. Browser wallet/success captures are refused,
so the canonical outcome is not duplicated by optimistic UI delivery.

## Reconciliation and delivery

`GET` or `POST /api/cron/reconcile-transactions` uses `requireCronSecret` and a Redis
lease. A run reads at most 50 due future-policy transactions from the pinned
network, has a 12-second transaction budget and a three-second RPC deadline per
item, then gives at most 20 outbox deliveries a six-second budget. Claims and
conditional updates remain idempotent when Redis is unavailable.

The job must be scheduled every minute with the existing cron-secret header.
Scheduling and successful authenticated runs must be independently verified before
claiming unattended finality. A code test is not that verification. The existing
five-minute deployment timeout finalizer excludes usage-v2 rows.

For a controlled admin/testnet deployment that leaves finality and setup to cron,
use the expiring, flow-scoped [deployment recovery rehearsal](deployment-recovery-rehearsal.md).
Its local checks do not replace live scheduler, setup and delivery evidence.

Closing the browser does not prevent this job from reading chain finality.
Deployment confirmation invokes the same setup code as interactive submission,
including subscription schedules, streamer jobs, payroll employees, KYC and webhook
credentials. Missing outcomes use exponential backoff. After six days of no result,
a row remains UNRESOLVED and stops automatic lookups rather than becoming FAILED;
RPC retention does not permit a reliable negative historical conclusion.

## Reports and PostHog dashboard

Run the separate versioned exporter with an explicitly authorized database:

```bash
pnpm analytics:metrics --start=2026-10-06T00:00:00Z --end=2026-10-07T00:00:00Z \
  --network=testnet --audience=EXTERNAL --output=usage-v2-report.json
```

Use dates at/after that database's actual cutover. Output creation refuses to
replace an existing file. SQL uses bound parameters and aggregates in Postgres;
exports contain totals and definitions, not addresses or account details.
The window is `[start,end)` for received connections/attempts, with outcomes as of
`generated_at`. A later confirmation can change an earlier submission cohort's
success total, so always keep the report timestamp.

| Metric                      | DB / PostHog definition                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Connections                 | Acknowledged unique connection IDs                                 |
| Connected addresses         | Distinct acknowledged wallet public addresses                      |
| Transaction-using addresses | Distinct source addresses on confirmed hashes, including API users |
| Meaningful active accounts  | Distinct session/API-caller accounts with confirmed activity       |
| Deployed flows              | Distinct Flow IDs with a confirmed deployment attempt              |
| Deployments                 | Distinct Deployment IDs with a confirmed deploy attempt            |
| Successful executions       | Confirmed non-deploy hashes; never count contract-event rows       |
| Unresolved/rejected/failed  | Separate attempt lifecycle populations                             |

The matching [dashboard definitions](usage-v2-dashboard.md) cover these totals and
observed journeys: activation, time to first success, retention, feature adoption,
errors and recovery. DB reporting is authoritative. PostHog event delivery may lag,
and blocked/lost browser events make journey denominators observed users only.
Filters always include policy version, explicit network, audience and start/end;
`role != ADMIN` is not a substitute for external classification.

## Rollout evidence required

1. Apply and validate the migration in the authorized environment, rebuild and
   deploy, and record `AnalyticsPolicy.activatedAt` plus runtime version.
2. Verify replay off, IP-discard configuration and no fresh GeoIP properties.
3. Install the matching dashboard definitions with the explicit cutover window.
4. Configure the reconciliation job and verify cadence, authentication and results.
5. Observe one anonymous and one classified connection retry, abandoned transaction
   finality, outcome deduplication and sensitive-surface capture exclusions.
6. Compare a read-only DB export with matching PostHog series, stating delivery lag
   and observed-journey limits. Do not backfill or repair historical records.

## API request history

Future-only API request history and developer-report definitions are documented in
[API request history v1](api-request-history-v1.md). Its cutover and HTTP denominators
are independent of existing usage-v2 business outcomes.
