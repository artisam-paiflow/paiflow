import { PrismaClient, OffRampPayoutJobStatus } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((arg) => arg.length > 0);

  if (ids.length === 0) {
    console.error("Usage: pnpm tsx scripts/reset-offramp-jobs.ts <job-id-1> [<job-id-2> ...]");
    process.exit(1);
  }

  const result = await db.offRampPayoutJob.updateMany({
    where: { id: { in: ids }, status: OffRampPayoutJobStatus.FAILED },
    data: {
      status: OffRampPayoutJobStatus.PENDING,
      attemptCount: 0,
      lastError: null,
      runAt: new Date(),
    },
  });
  console.log("Reset failed jobs:", result.count);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
