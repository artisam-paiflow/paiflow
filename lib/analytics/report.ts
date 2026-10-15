import "server-only";
import { db } from "@/lib/db";
import { TRACKING_VERSION } from "./policy";
import { UsageReportError, UsageReportSchema, type UsageReportInput } from "./report-schema";
type Totals = {
  connections: bigint;
  connected_addresses: bigint;
  attempts: bigint;
  confirmed_deployments: bigint;
  distinct_deployed_flows: bigint;
  successful_executions: bigint;
  transaction_using_addresses: bigint;
  meaningful_active_accounts: bigint;
  unresolved: bigint;
  rejected: bigint;
  failed: bigint;
};
/** Separate versioned report; established Instawards evidence is unchanged. */
export async function usageReport(input: UsageReportInput) {
  const options = UsageReportSchema.parse(input);
  const policy = await db.analyticsPolicy.findUniqueOrThrow({
    where: { version: TRACKING_VERSION },
  });
  const start = new Date(options.start),
    end = new Date(options.end);
  if (start < policy.activatedAt)
    throw new UsageReportError("Report start precedes the usage-v2 cutover");
  const [totals] = await db.$queryRaw<Totals[]>`
    WITH connections AS (
      SELECT * FROM "WalletConnection" WHERE "trackingVersion" = ${TRACKING_VERSION}
        AND network = ${options.network} AND audience = ${options.audience}::"AnalyticsAudience"
        AND "createdAt" >= ${start} AND "createdAt" < ${end}
    ), attempts AS (
      SELECT * FROM "SignedTransaction" WHERE "trackingVersion" = ${TRACKING_VERSION}
        AND network = ${options.network} AND audience = ${options.audience}::"AnalyticsAudience"
        AND "createdAt" >= ${start} AND "createdAt" < ${end}
    ), successes AS (SELECT * FROM attempts WHERE outcome = 'CONFIRMED'),
    active_accounts AS (
      SELECT DISTINCT "callerAccountId" AS id FROM successes WHERE "callerAccountId" IS NOT NULL
    )
    SELECT (SELECT count(*) FROM connections) AS connections,
      (SELECT count(DISTINCT address) FROM connections) AS connected_addresses,
      (SELECT count(*) FROM attempts) AS attempts,
      (SELECT count(DISTINCT "deploymentId") FROM successes WHERE kind = 'DEPLOY') AS confirmed_deployments,
      (SELECT count(DISTINCT d."flowId") FROM successes s JOIN "Deployment" d ON d.id = s."deploymentId" WHERE s.kind = 'DEPLOY') AS distinct_deployed_flows,
      (SELECT count(*) FROM successes WHERE kind <> 'DEPLOY') AS successful_executions,
      (SELECT count(DISTINCT "signerAddress") FROM successes) AS transaction_using_addresses,
      (SELECT count(*) FROM active_accounts) AS meaningful_active_accounts,
      (SELECT count(*) FROM attempts WHERE outcome IN ('RECEIVED', 'ACCEPTED', 'UNRESOLVED')) AS unresolved,
      (SELECT count(*) FROM attempts WHERE outcome = 'REJECTED') AS rejected,
      (SELECT count(*) FROM attempts WHERE outcome = 'FAILED') AS failed
  `;
  if (!totals) throw new Error("Usage report query returned no row");
  return {
    report_version: TRACKING_VERSION,
    cutover: policy.activatedAt.toISOString(),
    generated_at: new Date().toISOString(),
    ...options,
    window: "[start,end), attempts/connections received in window; outcomes as of generated_at",
    totals: Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, value.toString()]),
    ),
    definitions: {
      connected_addresses: "Distinct acknowledged public addresses, not people",
      transaction_using_addresses:
        "Distinct source addresses on confirmed transactions, including API callers",
      meaningful_active_accounts:
        "Session accounts or API deployment-owner accounts with confirmed activity, not people",
      successful_executions: "Confirmed non-deploy transaction hashes, not contract event rows",
    },
  };
}
