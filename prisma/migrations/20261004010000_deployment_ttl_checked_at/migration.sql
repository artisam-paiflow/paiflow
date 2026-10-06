ALTER TABLE "Deployment" ADD COLUMN "ttlCheckedAt" TIMESTAMP(3), ADD COLUMN "ttlScanOffset" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Deployment_network_status_ttlCheckedAt_id_idx" ON "Deployment"("network", "status", "ttlCheckedAt", "id");
CREATE TABLE "TtlMaintenanceState" ("network" TEXT NOT NULL, "sharedOffset" INTEGER NOT NULL DEFAULT 0, "sharedFirst" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "TtlMaintenanceState_pkey" PRIMARY KEY ("network"));
