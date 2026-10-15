import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { API_DAILY_VERSION } from "@/lib/api/request-history/daily-schema";
import { API_HISTORY_VERSION } from "@/lib/api/request-history/schema";
import { ApiSummaryError, ApiSummaryInputSchema, ApiSummarySchema } from "./api-summary-schema";
import type { z } from "zod";

const DAY = 86_400_000;
/** Never invent a partial historical day's distribution from daily aggregates. */
export function apiSummaryWindow(requestedStart: string, end: string, coverageFrom: string) {
  const startMs =
    Math.ceil(Math.max(Date.parse(requestedStart), Date.parse(coverageFrom)) / DAY) * DAY;
  if (startMs >= Date.parse(end))
    throw new ApiSummaryError(
      "No fully covered API start day in this window; use --no-api or choose a later end",
    );
  const endMs = Date.parse(end);
  const boundary = Math.floor(endMs / DAY) * DAY;
  // Only the final partial UTC day needs raw records. Historical raw rows expire after 30 days.
  if (boundary !== endMs && boundary < Date.now() - 30 * DAY)
    throw new ApiSummaryError(
      "Historical API end must be UTC midnight outside raw retention; use --no-api or a midnight end",
    );
  return { start: new Date(startMs), boundary: new Date(boundary), end: new Date(endMs) };
}

/** Completed UTC days use durable totals; only the last partial day reads retained raw rows. */
export async function apiSummary(input: z.infer<typeof ApiSummaryInputSchema>) {
  const options = ApiSummaryInputSchema.parse(input);
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const [coverage] = await tx.$queryRaw<{ coverageFrom: Date }[]>`
        SELECT "coverageFrom" FROM "ApiRequestDailyCoverage" WHERE version = ${API_DAILY_VERSION}`;
        if (!coverage)
          throw new ApiSummaryError(
            "API aggregate coverage is missing; apply the daily aggregate migration or use --no-api",
          );
        const window = apiSummaryWindow(
          options.start,
          options.end,
          coverage.coverageFrom.toISOString(),
        );
        type Row = {
          endpoint: string | null;
          method: string | null;
          is_total: number;
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
        const rows = await tx.$queryRaw<Row[]>`
        WITH pieces AS (
          SELECT endpoint, method, requests, errors, "authenticationFailures" AS auth,
            "rateLimited" AS limited, "totalDurationMs" AS duration,
            "minDurationMs" AS minimum, "maxDurationMs" AS maximum, "lastOccurredAt" AS latest
          FROM "ApiRequestDailyAggregate"
          WHERE day >= ${window.start}::date AND day < ${window.boundary}::date
            AND network = ${options.network} AND environment = ${options.environment}
            AND audience = ${options.audience}::"AnalyticsAudience" AND "trackingVersion" = ${API_HISTORY_VERSION}
          UNION ALL
          SELECT endpoint, method, count(*)::bigint, count(*) FILTER (WHERE status >= 400)::bigint,
            count(*) FILTER (WHERE status = 401)::bigint, count(*) FILTER (WHERE status = 429)::bigint,
            sum("durationMs")::bigint, min("durationMs"), max("durationMs"), max("occurredAt")
          FROM "ApiRequestLog"
          WHERE "occurredAt" >= ${window.boundary} AND "occurredAt" < ${window.end}
            AND "occurredAt" >= ${window.start}
            AND network = ${options.network} AND environment = ${options.environment}
            AND audience = ${options.audience}::"AnalyticsAudience" AND "trackingVersion" = ${API_HISTORY_VERSION}
          GROUP BY endpoint, method
        )
        SELECT endpoint, method, GROUPING(endpoint, method)::int AS is_total,
          COALESCE(sum(requests),0)::text AS requests, COALESCE(sum(errors),0)::text AS errors,
          COALESCE(sum(auth),0)::text AS authentication_failures,
          COALESCE(sum(limited),0)::text AS rate_limited,
          COALESCE(sum(duration),0)::text AS total_duration_ms,
          (sum(duration)::numeric / NULLIF(sum(requests),0))::float8 AS mean_duration_ms,
          min(minimum) AS min_duration_ms, max(maximum) AS max_duration_ms,
          max(latest) AS newest_request
        FROM pieces GROUP BY GROUPING SETS ((), (endpoint, method))
        ORDER BY is_total DESC, endpoint, method LIMIT 1002`;
        if (rows.length > 1001)
          throw new ApiSummaryError("API endpoint group limit exceeded; no snapshot saved");
        const convert = ({
          endpoint: _endpoint,
          method: _method,
          is_total: _total,
          newest_request,
          ...row
        }: Row) => ({
          ...row,
          newest_request: newest_request?.toISOString() ?? null,
        });
        const total = rows.find((row) => row.is_total === 3);
        if (!total) throw new ApiSummaryError("API totals missing; no snapshot saved");
        return ApiSummarySchema.parse({
          query_version: 1,
          tracking_version: API_HISTORY_VERSION,
          environment: options.environment,
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          coverage_from: coverage.coverageFrom.toISOString(),
          generated_at: new Date().toISOString(),
          totals: convert(total),
          endpoints: rows
            .filter((row) => row.is_total === 0)
            .map((row) => ({
              ...convert(row),
              endpoint: row.endpoint,
              method: row.method,
            })),
        });
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  } catch (error) {
    if (error instanceof ApiSummaryError) throw error;
    throw new ApiSummaryError(
      "API analytics could not be read; check aggregate migration and SELECT access to ApiRequestLog, ApiRequestDailyAggregate and ApiRequestDailyCoverage, or use --no-api",
    );
  }
}
