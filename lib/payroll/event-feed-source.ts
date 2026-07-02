import { db } from "@/lib/db";
import { synthesizeEvents, type OffRampJobForEvents, type RunForEvents } from "./event-feed";

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
  updatedAt: true,
  lastError: true,
  providerRef: true,
  employee: { select: { label: true, address: true } },
} as const;

/**
 * Load and synthesize the payroll event timeline for a deployment, optionally
 * scoped to a single run. Off-ramp jobs are limited to payroll-linked jobs
 * (`payrollRunId` set) so unrelated splitter/dev off-ramps never leak in.
 */
export async function loadPayrollEvents(deploymentId: string, runId?: string) {
  const [runs, jobs] = await Promise.all([
    db.payrollRun.findMany({
      where: runId ? { id: runId, deploymentId } : { deploymentId },
      orderBy: [{ createdAt: "desc" }],
      include: RUN_INCLUDE,
    }),
    db.offRampPayoutJob.findMany({
      where: runId
        ? { deploymentId, payrollRunId: runId }
        : { deploymentId, payrollRunId: { not: null } },
      select: OFFRAMP_SELECT,
    }),
  ]);

  return synthesizeEvents(runs as RunForEvents[], jobs as OffRampJobForEvents[]);
}
