import { NextRequest, NextResponse } from "next/server";
import { StreamerClaimJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  prepareStreamerClaimByRelayerTx,
  readStreamerAvailable,
  submitStreamerClaimByRelayerTx,
} from "@/lib/stellar/relayer";
import { withRelayerLock } from "@/lib/stellar/client";
import {
  cancelPendingStreamerJobs,
  getDueStreamerJobs,
  rescheduleStreamerJob,
  scheduleNextStreamerClaimJobFromJob,
} from "@/lib/streamer-jobs";

export const dynamic = "force-dynamic";

const MAX_RETRY_ATTEMPTS = 3;

function isRetryableError(message: string): boolean {
  return (
    message.includes("txBadSeq") ||
    message.includes("BadSequence") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("RateLimit")
  );
}

function isKnownSkipError(message: string): boolean {
  return (
    message.includes("NothingToClaim") ||
    message.includes("Paused") ||
    message.includes("non-existent contract function") ||
    message.includes("MissingValue") ||
    message.includes("Unauthorized") ||
    message.includes("not sufficient to spend")
  );
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const jobs = await getDueStreamerJobs(db, 50);
    const results: Array<{
      jobId: string;
      contractAddress: string;
      status: "claimed" | "skipped" | "failed" | "cancelled";
      error?: string;
    }> = [];

    for (const job of jobs) {
      // Defensive: verify the deployment is still active.
      const deployment = await db.deployment.findUnique({
        where: { id: job.deploymentId },
        select: { status: true },
      });

      if (!deployment || deployment.status !== "CONFIRMED") {
        await cancelPendingStreamerJobs(db, job.deploymentId);
        results.push({
          jobId: job.id,
          contractAddress: job.contractAddress,
          status: "cancelled",
          error: "Deployment no longer CONFIRMED",
        });
        continue;
      }

      // Mark the job as running so a concurrent cron invocation does not
      // pick it up again.
      await rescheduleStreamerJob(db, job.id, {
        status: StreamerClaimJobStatus.RUNNING,
      });

      try {
        const available = await readStreamerAvailable(job.contractAddress);

        if (available <= 0) {
          await rescheduleStreamerJob(db, job.id, {
            status: StreamerClaimJobStatus.SKIPPED,
            lastError: "NothingToClaim (available <= 0)",
          });
          await scheduleNextStreamerClaimJobFromJob(db, job);
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "skipped",
          });
          continue;
        }

        const submit = await withRelayerLock(async () => {
          const { xdr } = await prepareStreamerClaimByRelayerTx(job.contractAddress);
          return submitStreamerClaimByRelayerTx(xdr);
        });

        if (submit.status === "SUCCESS") {
          log.info(
            {
              jobId: job.id,
              deploymentId: job.deploymentId,
              contractAddress: job.contractAddress,
              txHash: submit.txHash,
              availableStroops: available.toString(),
            },
            "Streamer claim succeeded",
          );
          await rescheduleStreamerJob(db, job.id, {
            status: StreamerClaimJobStatus.CLAIMED,
            claimedAt: new Date(),
          });
          await scheduleNextStreamerClaimJobFromJob(db, job);
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "claimed",
          });
        } else {
          const errorMessage = submit.errorMessage ?? "Submission failed";
          if (isRetryableError(errorMessage) && job.attemptCount < MAX_RETRY_ATTEMPTS) {
            const retryAt = new Date(Date.now() + 60_000 * (job.attemptCount + 1));
            await db.streamerClaimJob.update({
              where: { id: job.id },
              data: {
                status: StreamerClaimJobStatus.PENDING,
                runAt: retryAt,
                lastError: errorMessage,
                attemptCount: { increment: 1 },
              },
            });
          } else {
            await rescheduleStreamerJob(db, job.id, {
              status: StreamerClaimJobStatus.FAILED,
              lastError: errorMessage,
            });
            await scheduleNextStreamerClaimJobFromJob(db, job);
          }
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: errorMessage,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (isKnownSkipError(message)) {
          await rescheduleStreamerJob(db, job.id, {
            status: StreamerClaimJobStatus.SKIPPED,
            lastError: message,
          });
          await scheduleNextStreamerClaimJobFromJob(db, job);
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "skipped",
          });
        } else if (isRetryableError(message) && job.attemptCount < MAX_RETRY_ATTEMPTS) {
          const retryAt = new Date(Date.now() + 60_000 * (job.attemptCount + 1));
          await db.streamerClaimJob.update({
            where: { id: job.id },
            data: {
              status: StreamerClaimJobStatus.PENDING,
              runAt: retryAt,
              lastError: message,
              attemptCount: { increment: 1 },
            },
          });
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: message,
          });
        } else {
          log.warn(
            {
              jobId: job.id,
              deploymentId: job.deploymentId,
              contractAddress: job.contractAddress,
              error: message,
            },
            "Streamer claim failed",
          );
          await rescheduleStreamerJob(db, job.id, {
            status: StreamerClaimJobStatus.FAILED,
            lastError: message,
          });
          await scheduleNextStreamerClaimJobFromJob(db, job);
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: message,
          });
        }
      }
    }

    const claimed = results.filter((r) => r.status === "claimed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const cancelled = results.filter((r) => r.status === "cancelled").length;

    return NextResponse.json({
      data: {
        claimed,
        skipped,
        failed,
        cancelled,
        processed: jobs.length,
        details: results,
      },
    });
  });
}

export const GET = POST;
