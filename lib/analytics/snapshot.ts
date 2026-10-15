import { z } from "zod";
import { PosthogSummarySchema } from "./posthog-report-schema";

const count = z.string().regex(/^\d+$/);
export const SnapshotReportSchema = z
  .object({
    report_version: z.string(),
    cutover: z.string().datetime(),
    generated_at: z.string().datetime(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    network: z.enum(["testnet", "mainnet"]),
    audience: z.enum(["INTERNAL", "EXTERNAL", "SANDBOX", "UNCLASSIFIED"]),
    posthog: PosthogSummarySchema.optional(),
    totals: z.object({
      connections: count,
      connected_addresses: count,
      attempts: count,
      confirmed_deployments: count,
      distinct_deployed_flows: count,
      successful_executions: count,
      transaction_using_addresses: count,
      meaningful_active_accounts: count,
      unresolved: count,
      rejected: count,
      failed: count,
    }),
  })
  .passthrough();
export type SnapshotReport = z.infer<typeof SnapshotReportSchema>;
export const SavedSnapshotSchema = z
  .object({
    snapshot_version: z.literal(1),
    report: SnapshotReportSchema,
  })
  .passthrough();

/** Outcomes can change for older attempts. These are net changes, not interval activity. */
export function compareSnapshots(current: SnapshotReport, previous: SnapshotReport) {
  if (
    current.report_version !== previous.report_version ||
    current.cutover !== previous.cutover ||
    current.network !== previous.network ||
    current.audience !== previous.audience ||
    Date.parse(current.start) !== Date.parse(previous.start) ||
    Date.parse(current.end) < Date.parse(previous.end) ||
    Date.parse(current.generated_at) <= Date.parse(previous.generated_at)
  )
    return null;

  return Object.fromEntries(
    Object.entries(current.totals).map(([metric, value]) => {
      const before = previous.totals[metric as keyof SnapshotReport["totals"]];
      const delta = BigInt(value) - BigInt(before);
      return [metric, { previous: before, current: value, delta: delta.toString() }];
    }),
  );
}

export function latestCompatibleSnapshot(current: SnapshotReport, history: SnapshotReport[]) {
  return history
    .filter((previous) => compareSnapshots(current, previous) !== null)
    .sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at))[0];
}

export function comparePosthogSnapshots(current: SnapshotReport, previous: SnapshotReport) {
  const a = current.posthog,
    b = previous.posthog;
  if (
    !a ||
    !b ||
    !compareSnapshots(current, previous) ||
    a.query_version !== b.query_version ||
    a.api_host !== b.api_host ||
    a.project_id !== b.project_id ||
    a.app_env !== b.app_env ||
    a.app_host !== b.app_host
  )
    return null;
  return Object.fromEntries(
    Object.entries(a.totals).map(([metric, value]) => [
      metric,
      {
        previous: b.totals[metric as keyof typeof b.totals]!,
        current: value!,
        delta: (BigInt(value!) - BigInt(b.totals[metric as keyof typeof b.totals]!)).toString(),
      },
    ]),
  );
}
