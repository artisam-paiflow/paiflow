-- CreateEnum
CREATE TYPE "TimelockMode" AS ENUM ('AFTER', 'BEFORE');

-- CreateTable
CREATE TABLE "TimelockRelease" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "templateKind" "TemplateKind" NOT NULL,
    "mode" "TimelockMode",
    "unlockAt" TIMESTAMP(3),
    "nextProbeAt" TIMESTAMP(3),
    "settledLedger" INTEGER,
    "lastReleasedAt" TIMESTAMP(3),
    "lastReleaseTxHash" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "unsupportedReason" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelockRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimelockRelease_contractAddress_key" ON "TimelockRelease"("contractAddress");

-- CreateIndex
CREATE INDEX "TimelockRelease_deploymentId_idx" ON "TimelockRelease"("deploymentId");

-- CreateIndex
CREATE INDEX "TimelockRelease_nextProbeAt_idx" ON "TimelockRelease"("nextProbeAt");

-- CreateIndex
CREATE INDEX "ContractEvent_deploymentId_kind_ledger_idx" ON "ContractEvent"("deploymentId", "kind", "ledger");

-- AddForeignKey
ALTER TABLE "TimelockRelease" ADD CONSTRAINT "TimelockRelease_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
