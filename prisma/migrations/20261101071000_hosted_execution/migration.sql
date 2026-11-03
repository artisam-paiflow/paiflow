-- Existing deployments remain private by default; retained receipts are unchanged.
ALTER TABLE "Deployment" ADD COLUMN "hostedExecutionEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WalletControlIntent" ADD COLUMN "hostedAccessHash" TEXT;
CREATE INDEX "WalletControlIntent_deploymentId_network_hostedAccessHash_idx"
  ON "WalletControlIntent"("deploymentId", "network", "hostedAccessHash");
