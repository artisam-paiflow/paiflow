import {
  OffRampJobSource,
  OffRampPayoutJobStatus,
  PrismaClient,
  type Prisma,
} from "@prisma/client";

export const TERMINAL_OFFRAMP_STATUSES: OffRampPayoutJobStatus[] = [
  OffRampPayoutJobStatus.COMPLETED,
  OffRampPayoutJobStatus.FAILED,
  OffRampPayoutJobStatus.CANCELLED,
];

/**
 * Return pending or running off-ramp jobs that are due, oldest first.
 *
 * Jobs are now self-contained: the bank details, deployment, source address, and
 * job source are stored inline, so the cron does not need the payroll/employee
 * relations (those are optional audit back-pointers now).
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
      deployment: { include: { offRampSenderProfile: true } },
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
      deployment: { select: { contractAddress: true } },
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
    const bankDetail = payout.employee.bankDetail;
    if (!bankDetail) continue;
    if (payout.offRampJobs.length > 0) continue;

    const job = await prisma.offRampPayoutJob.create({
      data: {
        source: OffRampJobSource.PAYROLL,
        deploymentId: run.deploymentId,
        sourceAddress: run.deployment.contractAddress ?? undefined,
        payrollRunId: run.id,
        employeeId: payout.employeeId,
        payrollPayoutId: payout.id,
        amountStroops: payout.amountStroops,
        bankAccountName: bankDetail.accountName,
        bankAccountNumber: bankDetail.accountNumber,
        bankCode: bankDetail.bankCode,
        status: OffRampPayoutJobStatus.PENDING,
        runAt: now,
      },
    });
    created.push(job.id);
  }

  return created;
}

/**
 * Create an off-ramp job from an on-chain cash_out event. The contract only
 * emits the amount and source address; the bank details are read from the
 * deployment's stored cash_out node config (filled via API after deploy).
 */
export async function createCashOutJob(
  prisma: PrismaClient,
  opts: {
    deploymentId: string;
    sourceAddress: string;
    amountStroops: string;
    bankAccountName: string;
    bankAccountNumber: string;
    bankCode: string;
  },
) {
  return prisma.offRampPayoutJob.create({
    data: {
      source: OffRampJobSource.CASH_OUT,
      deploymentId: opts.deploymentId,
      sourceAddress: opts.sourceAddress,
      amountStroops: opts.amountStroops,
      bankAccountName: opts.bankAccountName,
      bankAccountNumber: opts.bankAccountNumber,
      bankCode: opts.bankCode,
      status: OffRampPayoutJobStatus.PENDING,
      runAt: new Date(),
    },
  });
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
      deploymentId,
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
