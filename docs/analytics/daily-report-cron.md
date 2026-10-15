# Daily API reporting cron

The `analytics:api-daily-cron` command exports completed UTC days from the durable
API aggregates. It reads the database, writes JSON files, disconnects, and exits.
It does not run the web server, migrations, telemetry draining or PostHog queries.
It does not calculate the cumulative snapshot command's deltas. See
[daily aggregate definitions and coverage](api-request-history-v1.md#durable-daily-aggregates).

## Prepared Railway service

`.railway/api-daily-report.json` is a separate **new-service** configuration for
staging: testnet, analytics environment `beta`, and audience `EXTERNAL`. Railway's
environment name and the stored analytics environment are separate values.
Its schedule is `0 1 * * *`: 01:00 UTC / 09:00 Philippine time, every day. It reads
yesterday plus the two preceding UTC days to refresh reports for late telemetry.

This configuration has not been deployed. It does not provision a service,
credentials or a volume. Do not attach it to the existing application service.
Do not apply `.railway/railway.ts`; its separate #529 review restriction remains.

After review, configure a new Railway service named `api-daily-report` in the
intended project/environment:

1. Use this repository at a branch containing the daily aggregate migration and
   these scripts. Keep the source root at the repository root. Set its config file
   path to `/.railway/api-daily-report.json`.
2. Attach a dedicated persistent volume at `/reports` before the first execution.
   Reports on the container filesystem alone are not durable. Keep one replica.
3. Set only `DATABASE_URL` for a dedicated analytics login using the **live**
   staging Postgres service's private hostname and port. The staging archive is a
   different database; do not use it. No public networking or local SSH tunnel is
   needed. Do not copy the application's admin connection or other app secrets.
4. Ensure migrations are already applied by the normal application deployment.
   The analytics role needs CONNECT, USAGE on `public`, and SELECT on
   `ApiRequestDailyAggregate` and `ApiRequestDailyCoverage`. The
   [existing grant instructions](api-request-history-v1.md#daily-report) apply.
5. The custom Dockerfile installs pinned dependencies including `tsx` and generates
   Prisma Client at build time. It copies no `.env` files. No Next.js compilation,
   pre-deploy migration, health check or public domain is needed. Leave pre-deploy
   commands empty and review the explicit start command and filters before deploy.
6. Run the cron once and check logs for three saved-file paths and successful exit.
   Check that the files persist on the mounted volume. Railway's scheduler handles
   subsequent runs; the process does not contain its own scheduler. Failures exit
   nonzero; the configured restart policy is NEVER. Inspect logs and rerun after
   correcting a failure. The separate telemetry-drain cron still must operate.

For another environment, change the service's start-command filters and use that
database's read-only login and separate volume. Never mix databases in one output
history. For another audience use another explicit invocation or service.

[Railway cron lifecycle and UTC schedules](https://docs.railway.com/cron-jobs),
[config file fields](https://docs.railway.com/config-as-code/reference), and
[persistent volumes](https://docs.railway.com/volumes).

## Output and reruns

Files are stored as:

```text
/reports/api/beta/testnet/EXTERNAL/YYYY-MM-DD/<run-timestamp>-<uuid>.json
```

Every execution saves a new revision for each day. Earlier revisions are preserved;
a later report for a day supersedes its earlier totals. Do not add revisions
together: they contain the same day's freshly queried totals. Files are published
by rename after a complete write; interrupted temporary `.tmp` files can be removed
when no writer is active. Different days are independent; if a run fails midway,
earlier completed files remain valid and rerunning safely creates new revisions.

The refresh window is bounded to 1–31 days (`--lookback-days`, default 3). Queued
requests arriving later than that window require a manual historical rerun. Gaps
longer than the window likewise need a backfill. Before the aggregate coverage
start, queries fail rather than invent zeroes; if the default window precedes
coverage during initial setup, temporarily use `--lookback-days 1`.

For a historical completed UTC day, run in the reporting service environment (or
locally with your read-only connection and an open tunnel):

```bash
pnpm analytics:api-daily-cron \
  --network testnet --environment beta --audience EXTERNAL \
  --dir /reports/api --day 2026-10-13
```

`--day` exports exactly that one day and takes precedence over lookback. Date ranges
use UTC boundaries, not Philippine calendar days. Missing persisted traffic may
mean no requests or a telemetry gap; this job cannot certify queue completeness.
It preserves endpoint counts, errors, mean/min/max latency, and coverage metadata;
it is not a superset of the raw report's identities or p50/p95. Download/copy JSON
from the volume with your operational tooling; there is no email or public report
endpoint. Files accumulate indefinitely; monitor volume space and archive old
revisions before deleting them under your chosen retention policy.
