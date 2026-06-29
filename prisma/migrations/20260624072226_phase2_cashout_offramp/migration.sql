-- CreateEnum
CREATE TYPE "OffRampJobSource" AS ENUM ('PAYROLL', 'CASH_OUT');

-- Add new nullable columns first so we can backfill them safely.
ALTER TABLE "OffRampPayoutJob"
ADD COLUMN "bankAccountName" TEXT,
ADD COLUMN "bankAccountNumber" TEXT,
ADD COLUMN "bankCode" TEXT,
ADD COLUMN "deploymentId" UUID,
ADD COLUMN "source" "OffRampJobSource" NOT NULL DEFAULT 'PAYROLL',
ADD COLUMN "sourceAddress" TEXT;

-- Backfill deploymentId and bank details from the legacy payroll relations.
UPDATE "OffRampPayoutJob" AS j
SET "deploymentId" = (SELECT pr."deploymentId" FROM "PayrollRun" AS pr WHERE pr."id" = j."payrollRunId"),
    "bankAccountName" = (
      SELECT ebd."accountName"
      FROM "EmployeeBankDetail" AS ebd
      WHERE ebd."employeeId" = j."employeeId"
      LIMIT 1
    ),
    "bankAccountNumber" = (
      SELECT ebd."accountNumber"
      FROM "EmployeeBankDetail" AS ebd
      WHERE ebd."employeeId" = j."employeeId"
      LIMIT 1
    ),
    "bankCode" = (
      SELECT ebd."bankCode"
      FROM "EmployeeBankDetail" AS ebd
      WHERE ebd."employeeId" = j."employeeId"
      LIMIT 1
    )
WHERE j."payrollRunId" IS NOT NULL;

-- Make deploymentId required now that existing rows have been populated, and
-- relax the legacy payroll foreign keys to nullable audit back-references.
ALTER TABLE "OffRampPayoutJob"
ALTER COLUMN "deploymentId" SET NOT NULL,
ALTER COLUMN "payrollRunId" DROP NOT NULL,
ALTER COLUMN "employeeId" DROP NOT NULL,
ALTER COLUMN "payrollPayoutId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_deploymentId_idx" ON "OffRampPayoutJob"("deploymentId");

-- AddForeignKey
ALTER TABLE "OffRampPayoutJob" ADD CONSTRAINT "OffRampPayoutJob_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
