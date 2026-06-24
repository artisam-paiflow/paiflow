import { OffRampPayoutJobStatus, PrismaClient, type Prisma } from "@prisma/client";

export const TERMINAL_OFFRAMP_STATUSES: OffRampPayoutJobStatus[] = [
  OffRampPayoutJobStatus.COMPLETED,
  OffRampPayoutJobStatus.FAILED,
  OffRampPayoutJobStatus.CANCELLED,
];

/**
 * Return pending or running off-ramp jobs that are due, oldest first.
 */
export async function getDueOffRampJobs(prisma: PrismaClient, limit = 50) {
  return prisma.offRampPayoutJob.findMany({
    where: {
      status: { in: [OffRampPayoutJobStatus.PENDING, OffRampPayoutJobStatus.RUNNING] },
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: limit,
    include: {
      employee: { include: { bankDetail: true } },
      payrollPayout: true,
      payrollRun: { select: { deploymentId: true } },
    },
  });
}

/**
 * Reschedule/advance an existing off-ramp job.
 */
export async function rescheduleOffRampJob(
  prisma: PrismaClient,
  jobId: string,
  updates: {
    runAt?: Date | null;
    status: OffRampPayoutJobStatus;
    providerRef?: string | null;
    tradeRef?: string | null;
    requestId?: string | null;
    providerQuote?: Prisma.InputJsonValue | null;
    lastError?: string | null;
    completedAt?: Date | null;
    attemptCount?: number;
  },
) {
  const data: Record<string, unknown> = { status: updates.status };
  if (updates.runAt !== undefined) data.runAt = updates.runAt;
  if (updates.providerRef !== undefined) data.providerRef = updates.providerRef;
  if (updates.tradeRef !== undefined) data.tradeRef = updates.tradeRef;
  if (updates.requestId !== undefined) data.requestId = updates.requestId;
  if (updates.providerQuote !== undefined) data.providerQuote = updates.providerQuote;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;
  if (updates.completedAt !== undefined) data.completedAt = updates.completedAt;
  if (updates.attemptCount !== undefined) data.attemptCount = updates.attemptCount;

  return prisma.offRampPayoutJob.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Create off-ramp payout jobs for every payout in a payroll run whose employee
 * has bank details configured. Skips employees without bank details and
 * employees that already have a job for this payout.
 */
export async function createOffRampJobsForPayrollRun(prisma: PrismaClient, payrollRunId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    include: {
      payouts: {
        include: {
          employee: { include: { bankDetail: true } },
          offRampJobs: { select: { id: true } },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`PayrollRun not found: ${payrollRunId}`);
  }

  const now = new Date();
  const created: string[] = [];

  for (const payout of run.payouts) {
    if (!payout.employee.bankDetail) continue;
    if (payout.offRampJobs.length > 0) continue;

    const job = await prisma.offRampPayoutJob.create({
      data: {
        payrollRunId: run.id,
        employeeId: payout.employeeId,
        payrollPayoutId: payout.id,
        amountStroops: payout.amountStroops,
        status: OffRampPayoutJobStatus.PENDING,
        runAt: now,
      },
    });
    created.push(job.id);
  }

  return created;
}

/**
 * Cancel all active off-ramp jobs for a deployment.
 */
export async function cancelPendingOffRampJobs(
  prisma: PrismaClient,
  deploymentId: string,
): Promise<number> {
  const result = await prisma.offRampPayoutJob.updateMany({
    where: {
      payrollRun: { deploymentId },
      status: {
        in: [OffRampPayoutJobStatus.PENDING, OffRampPayoutJobStatus.RUNNING],
      },
    },
    data: {
      status: OffRampPayoutJobStatus.CANCELLED,
      lastError: "Deployment is no longer CONFIRMED",
    },
  });

  return result.count;
}
