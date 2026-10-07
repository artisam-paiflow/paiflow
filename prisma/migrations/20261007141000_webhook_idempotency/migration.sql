-- Permanent event-key reservation; no automatic expiry or lease takeover.
CREATE TABLE "WebhookAttempt" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "txHash" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "ledger" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebhookAttempt_status_check" CHECK ("status" IN ('PREPARING', 'SUBMITTING', 'PENDING', 'UNKNOWN', 'REJECTED', 'SUCCESS', 'FAILED'))
);
CREATE UNIQUE INDEX "WebhookAttempt_deploymentId_keyHash_key" ON "WebhookAttempt"("deploymentId", "keyHash");
CREATE INDEX "WebhookAttempt_deploymentId_network_txHash_idx" ON "WebhookAttempt"("deploymentId", "network", "txHash");
ALTER TABLE "WebhookAttempt" ADD CONSTRAINT "WebhookAttempt_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
