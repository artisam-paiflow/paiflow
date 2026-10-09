CREATE TYPE "DeploymentServiceState" AS ENUM ('ACTIVE', 'RETIRING', 'RETIRED');
CREATE TYPE "DeploymentWorkState" AS ENUM ('OPEN', 'DONE', 'BLOCKED');
CREATE TYPE "ServiceTransactionState" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REJECTED');
ALTER TABLE "Deployment"
 ADD COLUMN "serviceState" "DeploymentServiceState" NOT NULL DEFAULT 'ACTIVE',
 ADD COLUMN "retirementRequestedAt" TIMESTAMP(3),
 ADD COLUMN "retiredAt" TIMESTAMP(3),
 ADD COLUMN "retirementCutoffLedger" INTEGER,
 ADD COLUMN "retirementReconciledAt" TIMESTAMP(3),
 ADD COLUMN "retirementCoverageGap" TEXT,
 ADD COLUMN "retirementBlocker" TEXT,
 ADD COLUMN "retirementCheckedAt" TIMESTAMP(3);
ALTER TABLE "OffRampPayoutJob" ADD COLUMN "settlementResolvedAt" TIMESTAMP(3), ADD COLUMN "settlementEvidence" TEXT;
CREATE TABLE "DeploymentWork" (
 "id" UUID NOT NULL PRIMARY KEY, "deploymentId" UUID NOT NULL,
 "kind" TEXT NOT NULL, "state" "DeploymentWorkState" NOT NULL DEFAULT 'OPEN',
 "blocker" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMP(3), "reconciliationEvidence" TEXT,
 CONSTRAINT "DeploymentWork_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ServiceTransaction" (
 "id" UUID NOT NULL PRIMARY KEY, "workId" UUID NOT NULL, "txHash" TEXT NOT NULL,
 "transport" TEXT NOT NULL, "state" "ServiceTransactionState" NOT NULL DEFAULT 'PENDING',
 "ledger" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceTransaction_workId_fkey" FOREIGN KEY ("workId") REFERENCES "DeploymentWork"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Deployment_serviceState_ownerId_createdAt_idx" ON "Deployment"("serviceState", "ownerId", "createdAt" DESC);
CREATE INDEX "Deployment_serviceState_status_nextChargeAt_idx" ON "Deployment"("serviceState", "status", "nextChargeAt");
CREATE INDEX "Deployment_serviceState_status_eventsPolledAt_idx" ON "Deployment"("serviceState", "status", "eventsPolledAt");
CREATE INDEX "Deployment_serviceState_retirementCheckedAt_idx" ON "Deployment"("serviceState", "retirementCheckedAt");
CREATE INDEX "Deployment_serviceState_network_status_ttlCheckedAt_id_idx" ON "Deployment"("serviceState", "network", "status", "ttlCheckedAt", "id");
CREATE INDEX "DeploymentWork_deploymentId_state_idx" ON "DeploymentWork"("deploymentId", "state");
CREATE UNIQUE INDEX "ServiceTransaction_workId_txHash_key" ON "ServiceTransaction"("workId", "txHash");
CREATE INDEX "ServiceTransaction_txHash_state_idx" ON "ServiceTransaction"("txHash", "state");
CREATE INDEX "ServiceTransaction_state_createdAt_idx" ON "ServiceTransaction"("state", "createdAt");
ALTER TABLE "Deployment" ADD CONSTRAINT "deployment_retirement_lifecycle" CHECK (
 ("serviceState" = 'ACTIVE' AND "retirementRequestedAt" IS NULL AND "retiredAt" IS NULL) OR
 ("serviceState" = 'RETIRING' AND "retirementRequestedAt" IS NOT NULL AND "retiredAt" IS NULL) OR
 ("serviceState" = 'RETIRED' AND "retirementRequestedAt" IS NOT NULL AND "retiredAt" IS NOT NULL AND "retirementReconciledAt" IS NOT NULL)
);
-- Irreversibility is also enforced for scripts and future code paths.
CREATE FUNCTION enforce_deployment_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."serviceState" = 'RETIRED' AND NEW."serviceState" <> 'RETIRED') OR
    (OLD."serviceState" = 'RETIRING' AND NEW."serviceState" = 'ACTIVE') THEN
   RAISE EXCEPTION 'Deployment retirement is irreversible';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deployment_retirement_irreversible BEFORE UPDATE ON "Deployment"
 FOR EACH ROW EXECUTE FUNCTION enforce_deployment_retirement();

ALTER TABLE "OffRampPayoutJob" ADD COLUMN "originatingEventId" UUID;
CREATE UNIQUE INDEX "OffRampPayoutJob_originatingEventId_key" ON "OffRampPayoutJob"("originatingEventId");
ALTER TABLE "OffRampPayoutJob" ADD CONSTRAINT "OffRampPayoutJob_originatingEventId_fkey" FOREIGN KEY ("originatingEventId") REFERENCES "ContractEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
