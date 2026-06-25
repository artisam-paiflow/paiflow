import { PrismaClient, OffRampPayoutJobStatus } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const ids = ["cadb7c62-2922-4a86-8bc1-b20e04580919", "072f7bbe-6bfe-45ef-b829-5366ef576c2b"];
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
