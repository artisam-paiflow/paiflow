-- CreateEnum
CREATE TYPE "OffRampPayoutJobStatus" AS ENUM ('PENDING', 'RUNNING', 'QUOTED', 'INITIATED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('PENDING', 'CHARGED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EventKind" ADD VALUE 'RECIPIENT_UPDATED';

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "offRampEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "amountStroops" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBankDetail" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeBankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "txHash" TEXT,
    "totalStroops" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayout" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amountStroops" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OffRampPayoutJob" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "payrollPayoutId" UUID NOT NULL,
    "amountStroops" TEXT NOT NULL,
    "status" "OffRampPayoutJobStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "tradeRef" TEXT,
    "requestId" TEXT,
    "providerQuote" JSONB,
    "runAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OffRampPayoutJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OffRampSenderProfile" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT NOT NULL DEFAULT 'n.a.',
    "lastName" TEXT NOT NULL,
    "countryOrigin" TEXT NOT NULL,
    "addressLineOne" TEXT,
    "addressLineTwo" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT,
    "zipCode" TEXT,
    "phoneNumber" TEXT,
    "nationality" TEXT,
    "nationalIdentityNumber" TEXT,
    "dob" TEXT,
    "placeOfBirth" TEXT,
    "sourceOfFunds" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OffRampSenderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_deploymentId_idx" ON "Employee"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_deploymentId_address_key" ON "Employee"("deploymentId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeBankDetail_employeeId_key" ON "EmployeeBankDetail"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeBankDetail_employeeId_idx" ON "EmployeeBankDetail"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollRun_deploymentId_runAt_idx" ON "PayrollRun"("deploymentId", "runAt");

-- CreateIndex
CREATE INDEX "PayrollRun_status_runAt_idx" ON "PayrollRun"("status", "runAt");

-- CreateIndex
CREATE INDEX "PayrollPayout_payrollRunId_idx" ON "PayrollPayout"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollPayout_employeeId_idx" ON "PayrollPayout"("employeeId");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_status_runAt_idx" ON "OffRampPayoutJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_payrollRunId_idx" ON "OffRampPayoutJob"("payrollRunId");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_employeeId_idx" ON "OffRampPayoutJob"("employeeId");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_providerRef_idx" ON "OffRampPayoutJob"("providerRef");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_tradeRef_idx" ON "OffRampPayoutJob"("tradeRef");

-- CreateIndex
CREATE INDEX "OffRampPayoutJob_requestId_idx" ON "OffRampPayoutJob"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "OffRampSenderProfile_deploymentId_key" ON "OffRampSenderProfile"("deploymentId");

-- CreateIndex
CREATE INDEX "OffRampSenderProfile_deploymentId_idx" ON "OffRampSenderProfile"("deploymentId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBankDetail" ADD CONSTRAINT "EmployeeBankDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffRampPayoutJob" ADD CONSTRAINT "OffRampPayoutJob_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffRampPayoutJob" ADD CONSTRAINT "OffRampPayoutJob_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffRampPayoutJob" ADD CONSTRAINT "OffRampPayoutJob_payrollPayoutId_fkey" FOREIGN KEY ("payrollPayoutId") REFERENCES "PayrollPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffRampSenderProfile" ADD CONSTRAINT "OffRampSenderProfile_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
