-- CreateEnum
CREATE TYPE "EmployeePayoutMode" AS ENUM ('CRYPTO', 'FIAT');

-- AlterTable
ALTER TABLE "CashOutJobFailure" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "cashOutContractAddress" TEXT,
ADD COLUMN     "payoutMode" "EmployeePayoutMode" NOT NULL DEFAULT 'CRYPTO';

-- CreateIndex
CREATE INDEX "Employee_cashOutContractAddress_idx" ON "Employee"("cashOutContractAddress");
