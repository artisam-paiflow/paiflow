import { PrismaClient, StreamerClaimJobStatus } from "@prisma/client";
import type { StreamerParams } from "@/lib/flows/to-params";

export type StreamerJobParams = Pick<StreamerParams, "startTs" | "endTs" | "intervalSeconds">;

const TERMINAL_STATUSES: StreamerClaimJobStatus[] = [
  StreamerClaimJobStatus.CLAIMED,
  StreamerClaimJobStatus.SKIPPED,
  StreamerClaimJobStatus.FAILED,
  StreamerClaimJobStatus.CANCELLED,
];

/**
 * Compute the next streamer vesting milestone at or after `fromDate`.
 * Returns null when the stream has already ended.
 *
 * A milestone landing exactly on `endTs` IS returned: occurrence-based flows
 * set `endTs = startTs + occurrences × intervalSeconds`, so the final
 * interval vests at `endTs` itself — skipping that boundary leaves the last
 * payout vested but never auto-claimed.
 */
export function computeNextMilestone(
  startTs: number,
  endTs: number,
  intervalSeconds: number,
  fromDate: Date = new Date(),
): Date | null {
  if (intervalSeconds <= 0) return null;
  if (endTs <= startTs) return null;

  const nowSec = Math.floor(fromDate.getTime() / 1000);

  if (nowSec < startTs) {
    return new Date(startTs * 1000);
  }

  if (nowSec >= endTs) {
    return null;
  }

  const elapsed = nowSec - startTs;
  const intervalsPassed = Math.floor(elapsed / intervalSeconds);
  const nextSec = startTs + (intervalsPassed + 1) * intervalSeconds;

  if (nextSec > endTs) {
    return null;
  }

  return new Date(nextSec * 1000);
}

/**
 * Schedule the next claim job for a streamer node if one is not already pending
 * or running. The job is created at the next vesting milestone derived from the
 * stream parameters.
 */
export async function scheduleNextStreamerClaimJob(
  prisma: PrismaClient,
  deploymentId: string,
  nodeId: string,
  contractAddress: string,
  params: StreamerJobParams,
  fromDate: Date = new Date(),
): Promise<{ id: string; runAt: Date } | null> {
  const nextRunAt = computeNextMilestone(
    params.startTs,
    params.endTs,
    params.intervalSeconds,
    fromDate,
  );

  if (!nextRunAt) {
    return null;
  }

  const existing = await prisma.streamerClaimJob.findFirst({
    where: {
      deploymentId,
      nodeId,
      status: { notIn: TERMINAL_STATUSES },
    },
  });

  if (existing) {
    return { id: existing.id, runAt: existing.runAt };
  }

  const job = await prisma.streamerClaimJob.create({
    data: {
      deploymentId,
      nodeId,
      contractAddress,
      runAt: nextRunAt,
      status: StreamerClaimJobStatus.PENDING,
    },
  });

  return { id: job.id, runAt: job.runAt };
}

/**
 * Reschedule/advance an existing job. Passing a null runAt keeps the current
 * runAt while updating status/error fields.
 */
export async function rescheduleStreamerJob(
  prisma: PrismaClient,
  jobId: string,
  updates: {
    runAt?: Date | null;
    status: StreamerClaimJobStatus;
    lastError?: string | null;
    claimedAt?: Date | null;
  },
) {
  const data: Record<string, unknown> = { status: updates.status };
  if (updates.runAt !== undefined) data.runAt = updates.runAt;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;
  if (updates.claimedAt !== undefined) data.claimedAt = updates.claimedAt;

  return prisma.streamerClaimJob.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Return pending jobs that are due, oldest first.
 */
export async function getDueStreamerJobs(prisma: PrismaClient, limit = 50) {
  return prisma.streamerClaimJob.findMany({
    where: {
      status: StreamerClaimJobStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
}

/**
 * Cancel all active jobs for a deployment. Called when a deployment is no
 * longer CONFIRMED or is being archived.
 */
export async function cancelPendingStreamerJobs(
  prisma: PrismaClient,
  deploymentId: string,
): Promise<number> {
  const result = await prisma.streamerClaimJob.updateMany({
    where: {
      deploymentId,
      status: {
        in: [StreamerClaimJobStatus.PENDING, StreamerClaimJobStatus.RUNNING],
      },
    },
    data: {
      status: StreamerClaimJobStatus.CANCELLED,
      lastError: "Deployment is no longer CONFIRMED",
    },
  });

  return result.count;
}

type ParamsSnapshotEntry = {
  nodeId: string;
  templateKind: string;
  params: StreamerParams | { kind: string };
};

/**
 * Read a streamer's parameters from its deployment snapshot and schedule the
 * next claim job. Used by the cron runner after a terminal job state.
 */
export async function scheduleNextStreamerClaimJobFromJob(
  prisma: PrismaClient,
  job: {
    deploymentId: string;
    nodeId: string;
    contractAddress: string;
  },
  fromDate: Date = new Date(),
  logger?: { warn: (msg: string, ...args: unknown[]) => void },
): Promise<{ id: string; runAt: Date } | null> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: job.deploymentId },
    select: { paramsSnapshot: true },
  });

  if (!deployment?.paramsSnapshot) {
    return null;
  }

  const paramsArr = deployment.paramsSnapshot as ParamsSnapshotEntry[] | null;
  const nodeParams = paramsArr?.find((n) => n.nodeId === job.nodeId);

  if (!nodeParams || nodeParams.params.kind !== "streamer") {
    logger?.warn(
      `Could not find streamer params for job rescheduling (deployment=${job.deploymentId}, node=${job.nodeId})`,
    );
    return null;
  }

  const params = nodeParams.params as StreamerParams;
  return scheduleNextStreamerClaimJob(
    prisma,
    job.deploymentId,
    job.nodeId,
    job.contractAddress,
    params,
    fromDate,
  );
}
