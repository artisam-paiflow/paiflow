-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OffRampPayoutJob" ADD COLUMN "quotedAt" TIMESTAMP(3),
ADD COLUMN "initiatedAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3);
