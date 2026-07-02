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

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * How long a RUNNING job's lease is trusted before another cron run may assume
 * the prior run crashed/timed-out and re-claim it. Must comfortably exceed the
 * worst-case single-job runtime (deposit finality wait + quote/trade/payout).
 */
export const OFFRAMP_JOB_LEASE_MS = 10 * 60 * 1000;

/**
 * Return pending or running off-ramp jobs that are due, oldest first.
 *
 * PENDING jobs are always eligible. RUNNING jobs are only re-surfaced once their
 * lease has expired (or was never taken) — an actively-running job whose lease
 * is still fresh is treated as owned by the in-flight run and left alone, so we
 * do not race a live money-movement pass. Crashed/timed-out runs are recovered
 * once their lease goes stale.
 *
 * Jobs are self-contained: the bank details, deployment, source address, and
 * job source are stored inline, so the cron does not need the payroll/employee
 * relations (those are optional audit back-pointers now).
 */
export async function getDueOffRampJobs(prisma: PrismaClient, limit = 50) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OFFRAMP_JOB_LEASE_MS);
  return prisma.offRampPayoutJob.findMany({
    where: {
      runAt: { lte: now },
      OR: [
        { status: OffRampPayoutJobStatus.PENDING },
        {
          status: OffRampPayoutJobStatus.RUNNING,
          OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
        },
      ],
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
    pdaxDepositTxHash?: string | null;
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
  if (updates.pdaxDepositTxHash !== undefined) data.pdaxDepositTxHash = updates.pdaxDepositTxHash;
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
 * Atomically claim a due job for this cron run. Returns true if this caller won
 * the claim, false if another overlapping run already holds it. This prevents
 * two workers from both processing the same job (and, for native XLM cash-outs,
 * double-depositing).
 *
 * - PENDING claim: a one-shot CAS on `status`. Only the first caller flips
 *   PENDING -> RUNNING; the losers no longer match `status: PENDING`.
 * - RUNNING resume (stale lease): a `status: RUNNING` CAS alone is a no-op
 *   (RUNNING -> RUNNING matches for every concurrent caller), so we additionally
 *   match on the exact `lockedAt` the job was read with and bump it. Only the
 *   first caller's `lockedAt = expectedLockedAt` still matches; the losers see
 *   the refreshed lease and get `count === 0`.
 */
export async function claimOffRampJob(
  prisma: PrismaClient,
  jobId: string,
  fromStatus: OffRampPayoutJobStatus,
  expectedLockedAt: Date | null,
): Promise<boolean> {
  const now = new Date();

  if (fromStatus === OffRampPayoutJobStatus.PENDING) {
    const result = await prisma.offRampPayoutJob.updateMany({
      where: { id: jobId, status: OffRampPayoutJobStatus.PENDING },
      data: { status: OffRampPayoutJobStatus.RUNNING, lockedAt: now },
    });
    return result.count === 1;
  }

  const result = await prisma.offRampPayoutJob.updateMany({
    where: { id: jobId, status: OffRampPayoutJobStatus.RUNNING, lockedAt: expectedLockedAt },
    data: { lockedAt: now },
  });
  return result.count === 1;
}

/**
 * Create off-ramp payout jobs for every payout in a payroll run whose employee
 * has bank details configured. Skips employees without bank details and
 * employees that already have a job for this payout.
 */
export async function createOffRampJobsForPayrollRun(prisma: PrismaLike, payrollRunId: string) {
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

    const isFiat = payout.employee.payoutMode === "FIAT";
    const job = await prisma.offRampPayoutJob.create({
      data: {
        source: isFiat ? OffRampJobSource.CASH_OUT : OffRampJobSource.PAYROLL,
        deploymentId: run.deploymentId,
        sourceAddress: isFiat
          ? (payout.employee.cashOutContractAddress ?? undefined)
          : (run.deployment.contractAddress ?? undefined),
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
