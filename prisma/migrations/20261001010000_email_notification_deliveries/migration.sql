ALTER TABLE "EmailNotification" ADD COLUMN "deploymentId" UUID, ADD COLUMN "txHash" TEXT, ADD COLUMN "kind" TEXT, ADD COLUMN "deliveryKey" TEXT;
CREATE UNIQUE INDEX "EmailNotification_deliveryKey_key" ON "EmailNotification"("deliveryKey");
CREATE INDEX "EmailNotification_deploymentId_txHash_idx" ON "EmailNotification"("deploymentId", "txHash");
