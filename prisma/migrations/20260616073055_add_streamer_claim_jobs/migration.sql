-- CreateEnum
CREATE TYPE "StreamerClaimJobStatus" AS ENUM ('PENDING', 'RUNNING', 'CLAIMED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StreamerClaimJob" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "StreamerClaimJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerClaimJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamerClaimJob_status_runAt_idx" ON "StreamerClaimJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "StreamerClaimJob_deploymentId_nodeId_status_idx" ON "StreamerClaimJob"("deploymentId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "StreamerClaimJob_contractAddress_status_idx" ON "StreamerClaimJob"("contractAddress", "status");

-- AddForeignKey
ALTER TABLE "StreamerClaimJob" ADD CONSTRAINT "StreamerClaimJob_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
