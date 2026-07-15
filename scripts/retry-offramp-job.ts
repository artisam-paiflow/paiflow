import "server-only";
import { db } from "@/lib/db";
import { OffRampPayoutJobStatus } from "@prisma/client";

/**
 * Reset a FAILED off-ramp job back to PENDING so the process-offramp-jobs cron
 * picks it up on the next run. Use this when a downstream provider (e.g. PDAX)
 * has fixed an issue and the same job should be retried.
 *
 * Usage:
 *   npx tsx scripts/retry-offramp-job.ts <jobId>
 *
 * The cron's idempotency guards prevent double work:
 *   - Native XLM deposit: skipped when pdaxDepositTxHash is already set.
 *   - Trade: idempotency_id = jobId, so PDAX returns the existing order instead
 *     of creating a new one.
 */
async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npx tsx scripts/retry-offramp-job.ts <jobId>");
    process.exit(1);
  }

  const job = await db.offRampPayoutJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error(`Job ${jobId} not found`);
    process.exit(1);
  }

  console.log("Current job state:");
  console.log(
    JSON.stringify(
      {
        id: job.id,
        status: job.status,
        attemptCount: job.attemptCount,
        lastError: job.lastError,
        pdaxDepositTxHash: job.pdaxDepositTxHash,
        tradeRef: job.tradeRef,
        runAt: job.runAt,
      },
      null,
      2,
    ),
  );

  if (job.status === OffRampPayoutJobStatus.COMPLETED) {
    console.error("Job is already COMPLETED; refusing to retry.");
    process.exit(1);
  }

  const updated = await db.offRampPayoutJob.update({
    where: { id: jobId },
    data: {
      status: OffRampPayoutJobStatus.PENDING,
      runAt: new Date(),
      lastError: null,
    },
  });

  console.log("Reset job to PENDING with runAt = now:");
  console.log(
    JSON.stringify({ id: updated.id, status: updated.status, runAt: updated.runAt }, null, 2),
  );
  console.log("\nNext: trigger the cron with:");
  console.log(
    '  curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/process-offramp-jobs" -H "x-cron-secret: $CRON_SECRET"',
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
