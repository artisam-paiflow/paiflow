import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { API_HISTORY_VERSION } from "./schema";
import {
  API_DAILY_VERSION,
  ApiDailyReportError,
  ApiDailyReportSchema,
  type ApiDailyReportInput,
} from "./daily-schema";

type Totals = {
  requests: string;
  errors: string;
  authentication_failures: string;
  rate_limited: string;
  total_duration_ms: string;
  mean_duration_ms: number | null;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  newest_request: Date | null;
};
const totalsSql = Prisma.sql`
  COALESCE(sum(requests),0)::text AS requests,
  COALESCE(sum(errors),0)::text AS errors,
  COALESCE(sum("authenticationFailures"),0)::text AS authentication_failures,
  COALESCE(sum("rateLimited"),0)::text AS rate_limited,
  COALESCE(sum("totalDurationMs"),0)::text AS total_duration_ms,
  (sum("totalDurationMs")::numeric / NULLIF(sum(requests),0))::float8 AS mean_duration_ms,
  min("minDurationMs") AS min_duration_ms, max("maxDurationMs") AS max_duration_ms,
  max("lastOccurredAt") AS newest_request`;

/** Identity-free whole-day reporting. Raw request retention does not limit this report. */
export async function apiDailyReport(input: ApiDailyReportInput) {
  const options = ApiDailyReportSchema.parse(input);
  const start = new Date(options.start + "T00:00:00Z"),
    end = new Date(options.end + "T00:00:00Z");
  const where = Prisma.sql`day >= ${start}::date AND day < ${end}::date
    AND network = ${options.network} AND environment = ${options.environment}
    AND audience = ${options.audience}::"AnalyticsAudience" AND "trackingVersion" = ${API_HISTORY_VERSION}`;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const [coverage] = await tx.$queryRaw<{ coverageFrom: Date; backfilledAt: Date }[]>`
      SELECT "coverageFrom", "backfilledAt" FROM "ApiRequestDailyCoverage" WHERE version = ${API_DAILY_VERSION}`;
      if (!coverage)
        throw new ApiDailyReportError(
          "NOT_FOUND",
          "Daily aggregate migration has not established coverage",
        );
      const firstDay = coverage.coverageFrom.toISOString().slice(0, 10);
      if (options.start < firstDay)
        throw new ApiDailyReportError(
          "VALIDATION",
          `Daily aggregate coverage starts on ${firstDay} UTC; choose a start on or after that date`,
        );
      const [totals] = await tx.$queryRaw<
        Totals[]
      >`SELECT ${totalsSql} FROM "ApiRequestDailyAggregate" WHERE ${where}`;
      if (!totals) throw new Error("Daily totals query returned no row");
      const endpoints = await tx.$queryRaw<(Totals & { endpoint: string; method: string })[]>`
      SELECT endpoint, method, ${totalsSql} FROM "ApiRequestDailyAggregate" WHERE ${where}
      GROUP BY endpoint, method ORDER BY endpoint, method LIMIT 1001`;
      const daily = await tx.$queryRaw<(Totals & { day: Date })[]>`
      SELECT day, ${totalsSql} FROM "ApiRequestDailyAggregate" WHERE ${where}
      GROUP BY day ORDER BY day`;
      return {
        report_version: API_DAILY_VERSION,
        generated_at: new Date().toISOString(),
        ...options,
        coverage_from: coverage.coverageFrom.toISOString(),
        backfilled_at: coverage.backfilledAt.toISOString(),
        first_day_partial: start < coverage.coverageFrom,
        current_or_future_days_included: end.getTime() > Date.now(),
        totals,
        endpoints: endpoints.slice(0, 1000),
        endpoint_groups_truncated: endpoints.length > 1000,
        daily,
        definitions: {
          window: "[start,end), UTC whole dates; each request belongs to its occurredAt UTC date",
          counts:
            "Persisted wrapped API responses, not SDK method calls or unique accounts. HTTP errors have status >=400. Missing days have no persisted requests; queued/dropped requests are not reconstructed.",
          latency:
            "Weighted mean from total handler duration / request count; min/max are exact. No p50/p95 or distinct users are inferred from daily totals.",
          coverage:
            "Backfill includes retained raw history. Requests removed before migration cannot be recovered; the boundary day may be partial. Late arrivals can change older days. Future/current days are incomplete.",
          retention:
            "Daily aggregates and UUID-only replay receipts are retained independently of 30-day raw rows. No account/token/deployment IDs, addresses, bodies or credentials are retained in aggregates.",
        },
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
