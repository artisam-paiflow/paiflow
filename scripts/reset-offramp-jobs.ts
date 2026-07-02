import { PrismaClient, OffRampPayoutJobStatus } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  // Reset the job for retry but keep failedAt so the payroll event feed retains
  // a stable OFFRAMP_FAILED tombstone.
  const result = await db.offRampPayoutJob.updateMany({
    where: {
      deploymentId: "9cefd7fd-8e2a-4b6d-86f7-7de439e5ba4b",
      status: OffRampPayoutJobStatus.FAILED,
    },
    data: { status: OffRampPayoutJobStatus.PENDING, lastError: null, attemptCount: 0 },
  });
  console.log("reset", result.count, "jobs");
  await db.$disconnect();
})();
