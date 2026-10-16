import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { API_HISTORY_VERSION, ApiRequestReportSchema } from "./schema";
import { apiRequestHealth } from "./delivery";

/** Operator report: aggregate counts by internal account/token IDs; no wallet addresses or secrets. */
export async function apiRequestReport(input: z.infer<typeof ApiRequestReportSchema>) {
  const options = ApiRequestReportSchema.parse(input);
  const start = new Date(options.start),
    end = new Date(options.end);
  const policy = await db.analyticsPolicy.findUniqueOrThrow({
    where: { version: API_HISTORY_VERSION },
  });
  if (start < policy.activatedAt || start.getTime() < Date.now() - 30 * 86400000)
    throw new AppError("VALIDATION", "Window precedes retained request history or cutover");
  const report = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
      WITH requests AS (
        SELECT * FROM "ApiRequestLog" WHERE "trackingVersion" = ${API_HISTORY_VERSION}
        AND network = ${options.network} AND environment = ${options.environment}
        AND audience = ${options.audience}::"AnalyticsAudience"
        AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
      ) SELECT endpoint, method, "accountId" AS account_id, "apiTokenId" AS api_token_id, "developerApiTokenId" AS developer_api_token_id, "callerType" AS caller_type, "tokenCreatorId" AS token_creator_id, count(*)::text AS requests,
        count(*) FILTER (WHERE status >= 400)::text AS errors,
        count(*) FILTER (WHERE status = 401)::text AS authentication_failures,
        count(*) FILTER (WHERE status = 429)::text AS rate_limited,
        count(DISTINCT "accountId")::text AS calling_accounts,
        count(DISTINCT ("callerType", COALESCE("apiTokenId", "developerApiTokenId"))) FILTER (WHERE COALESCE("apiTokenId", "developerApiTokenId") IS NOT NULL)::text AS tokens,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms
      FROM requests GROUP BY endpoint, method, "accountId", "apiTokenId", "developerApiTokenId", "callerType", "tokenCreatorId" ORDER BY endpoint, method, "accountId", "callerType", "apiTokenId", "developerApiTokenId" LIMIT 1001`;
      const weeks = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT date_trunc('week', "occurredAt") AS week,
        count(DISTINCT "accountId")::text AS calling_accounts,
        count(DISTINCT r."accountId") FILTER (WHERE s.outcome = 'CONFIRMED' AND s."deploymentId"=r."deploymentId" AND s."callerAccountId"=r."accountId" AND s."createdAt">=${start} AND s."createdAt"<${end})::text AS confirmed_accounts
      FROM "ApiRequestLog" r LEFT JOIN "SignedTransaction" s ON s."txHash" = r."txHash" AND s.network = r.network AND s.audience = r.audience
      WHERE r."trackingVersion" = ${API_HISTORY_VERSION} AND r.network = ${options.network}
        AND r.environment = ${options.environment} AND r.audience = ${options.audience}::"AnalyticsAudience"
        AND r."occurredAt" >= ${start} AND r."occurredAt" < ${end}
      GROUP BY week ORDER BY week`;
      const outcomes = await tx.$queryRaw<Record<string, unknown>[]>`
      WITH hashes AS (SELECT DISTINCT "txHash" FROM "ApiRequestLog"
        WHERE "trackingVersion" = ${API_HISTORY_VERSION} AND network = ${options.network}
        AND environment = ${options.environment} AND audience = ${options.audience}::"AnalyticsAudience"
        AND "occurredAt" >= ${start} AND "occurredAt" < ${end} AND "txHash" IS NOT NULL)
      SELECT s.outcome, count(*)::text AS transactions,
        sum(GREATEST(s."submissionRevision"-1,0))::text AS actual_resends,
        count(DISTINCT s."signerAddress")::text AS signing_wallets,
        avg(EXTRACT(EPOCH FROM (s."confirmedAt"-s."submittedAt"))*1000)
          FILTER (WHERE s.outcome = 'CONFIRMED') AS mean_confirmation_ms,
        max(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-s."createdAt")))
          FILTER (WHERE s.outcome IN ('RECEIVED','ACCEPTED','UNRESOLVED')) AS oldest_unresolved_seconds
      FROM hashes h JOIN "SignedTransaction" s ON s."txHash" = h."txHash" AND s.network = ${options.network} AND s.audience=${options.audience}::"AnalyticsAudience"
      GROUP BY s.outcome ORDER BY s.outcome`;
      const retries = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT "txHash", count(*)::text AS requests FROM "ApiRequestLog"
      WHERE "trackingVersion" = ${API_HISTORY_VERSION} AND network = ${options.network}
        AND environment = ${options.environment} AND audience = ${options.audience}::"AnalyticsAudience"
        AND "occurredAt" >= ${start} AND "occurredAt" < ${end} AND "txHash" IS NOT NULL
        AND endpoint IN ('/api/v1/deployments/:id/execute/submit','/api/v1/deployments/:id/payouts/submit')
      GROUP BY "txHash" HAVING count(*) > 1 LIMIT 1000`;
      const activation = await tx.$queryRaw<Record<string, unknown>[]>`
      WITH first_calls AS (
        SELECT COALESCE("apiTokenId", "developerApiTokenId") AS token_id, "callerType" AS family,
          min("occurredAt") AS first_call FROM "ApiRequestLog"
        WHERE "trackingVersion" = ${API_HISTORY_VERSION} AND network = ${options.network}
          AND environment = ${options.environment} AND audience = ${options.audience}::"AnalyticsAudience"
          AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
          AND COALESCE("apiTokenId", "developerApiTokenId") IS NOT NULL
        GROUP BY token_id, "callerType"), tokens AS (
          SELECT id, "createdAt", 'deployment_token' AS family FROM "DeploymentApiToken"
          UNION ALL SELECT id, "createdAt", 'developer_token' AS family FROM "DeveloperApiToken")
      SELECT count(*)::text AS calling_tokens,
        avg(EXTRACT(EPOCH FROM (f.first_call-t."createdAt"))) AS mean_token_to_observed_call_seconds,
        count(*) FILTER (WHERE s.confirmed IS NOT NULL)::text AS tokens_with_confirmed_transactions
      FROM first_calls f JOIN tokens t ON t.id=f.token_id AND t.family=f.family
      LEFT JOIN LATERAL (SELECT min("confirmedAt") AS confirmed FROM "SignedTransaction"
        WHERE ((f.family='deployment_token' AND "apiTokenId"=f.token_id) OR
               (f.family='developer_token' AND "developerApiTokenId"=f.token_id)) AND network=${options.network}
          AND outcome='CONFIRMED' AND audience=${options.audience}::"AnalyticsAudience" AND "createdAt">=${start} AND "createdAt"<${end}) s ON true`;
      const preparation = await tx.$queryRaw<Record<string, unknown>[]>`
        WITH preparations AS (
          SELECT * FROM "ApiRequestLog" WHERE "trackingVersion"=${API_HISTORY_VERSION}
            AND network=${options.network} AND environment=${options.environment}
            AND audience=${options.audience}::"AnalyticsAudience" AND "occurredAt">=${start} AND "occurredAt"<${end}
            AND endpoint IN ('/api/v1/deployments/:id/execute','/api/v1/deployments/:id/payouts')
            AND status < 400 AND COALESCE("apiTokenId", "developerApiTokenId") IS NOT NULL
        ) SELECT count(*)::text AS preparations,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM "ApiRequestLog" s WHERE s."preparationRequestId"=p.id
              AND s.network=p.network AND s.environment=p.environment AND s.audience=p.audience AND s."accountId"=p."accountId"
              AND s."apiTokenId" IS NOT DISTINCT FROM p."apiTokenId" AND s."developerApiTokenId" IS NOT DISTINCT FROM p."developerApiTokenId" AND s."callerType"=p."callerType" AND s."deploymentId"=p."deploymentId"
              AND s.endpoint=p.endpoint || '/submit' AND s."occurredAt">=p."occurredAt"
              AND s."occurredAt"<p."occurredAt"+interval '24 hours' AND s."txHash" IS NOT NULL
          ))::text AS explicitly_linked_submissions
        FROM preparations p`;
      const submissionLinkage = await tx.$queryRaw<Record<string, unknown>[]>`
        WITH submissions AS (
          SELECT * FROM "ApiRequestLog" WHERE "trackingVersion"=${API_HISTORY_VERSION}
            AND network=${options.network} AND environment=${options.environment}
            AND audience=${options.audience}::"AnalyticsAudience" AND "occurredAt">=${start} AND "occurredAt"<${end}
            AND method='POST' AND COALESCE("apiTokenId", "developerApiTokenId") IS NOT NULL AND "txHash" IS NOT NULL
            AND endpoint IN ('/api/v1/deployments/:id/execute/submit','/api/v1/deployments/:id/payouts/submit')
        ), links AS (
          SELECT s.*, EXISTS (
            SELECT 1 FROM "ApiRequestLog" p WHERE p.id=s."preparationRequestId"
              AND p."trackingVersion"=s."trackingVersion" AND p.status<400 AND p.method='POST'
              AND p.network=s.network AND p.environment=s.environment AND p.audience=s.audience
              AND p."accountId"=s."accountId" AND p."apiTokenId" IS NOT DISTINCT FROM s."apiTokenId" AND p."developerApiTokenId" IS NOT DISTINCT FROM s."developerApiTokenId" AND p."callerType"=s."callerType"
              AND p."deploymentId"=s."deploymentId" AND s.endpoint=p.endpoint || '/submit'
              AND p."occurredAt">=${policy.activatedAt} AND p."occurredAt"<=s."occurredAt"
              AND s."occurredAt"<p."occurredAt"+interval '24 hours'
          ) AS linked FROM submissions s
        ) SELECT count(*)::text AS submitted_requests,
          count(*) FILTER (WHERE "preparationRequestId" IS NOT NULL)::text AS with_preparation_id,
          count(*) FILTER (WHERE linked)::text AS verified_linked_requests,
          count(*) FILTER (WHERE "preparationRequestId" IS NULL)::text AS missing_preparation_id,
          count(*) FILTER (WHERE "preparationRequestId" IS NOT NULL AND NOT linked)::text AS unmatched_preparation_id,
          100.0 * count(*) FILTER (WHERE linked) / NULLIF(count(*),0) AS linkage_coverage_percent
        FROM links`;
      const recovery = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT count(*)::text AS failed_submit_requests,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM "ApiRequestLog" retry JOIN "SignedTransaction" t ON t."txHash"=retry."txHash" AND t.network=retry.network
            WHERE retry."txHash"=failed."txHash" AND retry."apiTokenId" IS NOT DISTINCT FROM failed."apiTokenId" AND retry."developerApiTokenId" IS NOT DISTINCT FROM failed."developerApiTokenId" AND retry."callerType"=failed."callerType"
              AND retry."deploymentId"=failed."deploymentId" AND retry.environment=failed.environment
              AND retry.network=failed.network AND retry.audience=failed.audience AND retry."accountId"=failed."accountId"
              AND retry.endpoint=failed.endpoint AND retry."occurredAt">failed."occurredAt"
              AND retry."occurredAt"<failed."occurredAt"+interval '24 hours'
              AND retry.status<400 AND t."deploymentId"=retry."deploymentId" AND t."callerAccountId"=retry."accountId" AND t.outcome='CONFIRMED' AND t.audience=retry.audience
          ))::text AS recovered_same_hash_within_24h
        FROM "ApiRequestLog" failed WHERE failed."trackingVersion"=${API_HISTORY_VERSION}
          AND failed.network=${options.network} AND failed.environment=${options.environment}
          AND failed.audience=${options.audience}::"AnalyticsAudience"
          AND failed."occurredAt">=${start} AND failed."occurredAt"<${end}
          AND failed."txHash" IS NOT NULL AND failed.status>=400
          AND failed.endpoint IN ('/api/v1/deployments/:id/execute/submit','/api/v1/deployments/:id/payouts/submit')`;
      const jobs = await tx.$queryRaw<Record<string, unknown>[]>`
        WITH deployments AS (SELECT DISTINCT "deploymentId" AS id FROM "ApiRequestLog"
          WHERE "trackingVersion"=${API_HISTORY_VERSION} AND network=${options.network}
            AND environment=${options.environment} AND audience=${options.audience}::"AnalyticsAudience"
            AND "occurredAt">=${start} AND "occurredAt"<${end}), jobs AS (
          SELECT 'offramp' AS kind, j.status::text AS status, j."attemptCount" AS attempts, j."runAt", j."completedAt" AS finished
          FROM "OffRampPayoutJob" j JOIN deployments d ON d.id=j."deploymentId" WHERE j."runAt">=${start} AND j."runAt"<${end}
          UNION ALL
          SELECT 'streamer', j.status::text, j."attemptCount", j."runAt", j."claimedAt"
          FROM "StreamerClaimJob" j JOIN deployments d ON d.id=j."deploymentId" WHERE j."runAt">=${start} AND j."runAt"<${end}
          UNION ALL
          SELECT 'payroll', j.status::text, j."attemptCount", j."runAt", j."chargedAt"
          FROM "PayrollRun" j JOIN deployments d ON d.id=j."deploymentId" WHERE j."runAt">=${start} AND j."runAt"<${end})
        SELECT kind, status, count(*)::text AS jobs, sum(attempts)::text AS attempts,
          avg(EXTRACT(EPOCH FROM (finished-"runAt"))) FILTER (WHERE finished IS NOT NULL) AS mean_completion_lag_seconds
        FROM jobs GROUP BY kind,status ORDER BY kind,status`;
      return {
        endpoints: rows.slice(0, 1000),
        endpoint_groups_truncated: rows.length > 1000,
        weeks,
        outcomes,
        activation,
        preparation,
        submission_linkage: submissionLinkage,
        recovery,
        scheduled_jobs: jobs,
        repeated_submission_hashes: retries.length,
        repeated_submission_hashes_truncated: retries.length === 1000,
      };
    },
    { timeout: 25000 },
  );
  return {
    report_version: API_HISTORY_VERSION,
    cutover: policy.activatedAt.toISOString(),
    generated_at: new Date().toISOString(),
    ...options,
    ...report,
    delivery: await apiRequestHealth(),
    definitions: {
      window: "[start,end), request start time; chain outcomes as of generated_at",
      errors: "HTTP status >=400 / all recorded responses; not a chain failure rate",
      latency:
        "Handler response preparation, before telemetry acknowledgement; not network/stream duration",
      identity:
        "Authenticated deployment owner is the calling account; token creator is distinct; neither is assumed to be signer",
      activation:
        "First OBSERVED authenticated call in the selected window, not necessarily lifetime first call",
      retries:
        "Repeated submit requests for the same validated hash; distinct from chain submissionRevision",
      preparation:
        "Successful preparations with an explicitly linked validated submit within 24h, matching token/account/deployment/network/environment and operation. Missing links do not prove drop-off; windows under 24h old are immature.",
      submission_linkage:
        "Validated authenticated execute/payout submit requests in [start,end), including HTTP retries and failed responses with a validated hash. Coverage is requests with a verified successful preparation / all such requests. Preparation may precede start, but must follow cutover and be within 24h. IDs are verified against account/token/deployment/network/environment/audience and operation; a missing or unmatched ID does not prove abandonment. No requests yields null coverage.",
      recovery:
        "Failed submit HTTP responses followed by successful same-hash HTTP submit within 24h and confirmed chain outcome at report time; failure requests are denominator, not distinct intents.",
      scheduled_jobs:
        "Jobs due in window on deployments with recorded requests in the selected environment/audience; off-ramp, streamer and payroll only. Excludes other cron schedules; completion lag is finish minus scheduled runAt.",
      weeks: "UTC Monday weeks; confirmed accounts linked to requests in that week",
      limitations:
        "Wrapper-only; no openapi/demo-token, middleware refusals, interrupted handlers or undelivered telemetry. Retention is 30 days. Preparation links are opt-in, not proof of abandonment; 24h recovery covers same hashes only. Jobs cover off-ramp/streamer/payroll jobs on deployments observed in this request window; no complete scheduled-payment or cost coverage is claimed. Existing usage-v2 report covers broader flow/deploy/execution adoption.",
    },
  };
}
