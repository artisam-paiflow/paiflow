import { db } from "@/lib/db";
import {
  synthesizeEvents,
  decodeCursor,
  type OffRampJobForEvents,
  type RunForEvents,
} from "./event-feed";

const LOOKBACK_DAYS = 90;

function lookbackLowerBound(before: Date): Date {
  const d = new Date(before);
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
  return d;
}

/**
 * Prisma select fragments shared by the payroll event-feed endpoints. Kept
 * beside the loader so the fetched shape stays in lockstep with the
 * `RunForEvents` / `OffRampJobForEvents` contracts in `event-feed.ts`.
 */
const RUN_INCLUDE = {
  payouts: {
    select: {
      id: true,
      employeeId: true,
      amountStroops: true,
      txHash: true,
      createdAt: true,
      employee: { select: { label: true, address: true } },
    },
  },
} as const;

const OFFRAMP_SELECT = {
  id: true,
  status: true,
  amountStroops: true,
  payrollRunId: true,
  employeeId: true,
  payrollPayoutId: true,
  completedAt: true,
  quotedAt: true,
  initiatedAt: true,
  failedAt: true,
  cancelledAt: true,
  updatedAt: true,
  lastError: true,
  providerRef: true,
  employee: { select: { label: true, address: true } },
} as const;

/**
 * Load and synthesize the payroll event timeline for a deployment, optionally
 * scoped to a single run. Off-ramp jobs are limited to payroll-linked jobs
 * (`payrollRunId` set) so unrelated splitter/dev off-ramps never leak in.
 *
 * Queries are bounded by a 90-day lookback window relative to the cursor (or
 * now) plus a cap well above the requested page size, so polling does not load
 * the deployment's entire history on every request.
 */
export async function loadPayrollEvents(
  deploymentId: string,
  runId?: string,
  limit = 50,
  cursor?: string,
) {
  const beforeTime = cursor ? decodeCursor(cursor)?.time : undefined;
  const before = beforeTime ? new Date(beforeTime) : new Date();
  const lowerBound = lookbackLowerBound(before);
  const take = Math.max(limit * 10, 200);

  const [runs, jobs] = await Promise.all([
    db.payrollRun.findMany({
      where: {
        ...(runId ? { id: runId, deploymentId } : { deploymentId }),
        createdAt: {
          lte: before,
          gte: lowerBound,
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take,
      include: RUN_INCLUDE,
    }),
    db.offRampPayoutJob.findMany({
      where: {
        ...(runId
          ? { deploymentId, payrollRunId: runId }
          : { deploymentId, payrollRunId: { not: null } }),
        createdAt: {
          lte: before,
          gte: lowerBound,
        },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: OFFRAMP_SELECT,
    }),
  ]);

  return synthesizeEvents(runs as RunForEvents[], jobs as OffRampJobForEvents[]);
}
