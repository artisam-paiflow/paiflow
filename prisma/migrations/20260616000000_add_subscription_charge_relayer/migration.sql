-- Add subscription auto-charge scheduling and relayer configuration

CREATE TYPE "ChargeRelayerMode" AS ENUM ('PLATFORM', 'USER', 'MANUAL');

ALTER TABLE "Deployment"
    ADD COLUMN "chargeRelayerMode" "ChargeRelayerMode" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "chargeRelayerUrl" TEXT,
    ADD COLUMN "chargeRelayerToken" TEXT,
    ADD COLUMN "chargeRelayerAddress" TEXT,
    ADD COLUMN "nextChargeAt" TIMESTAMP(3),
    ADD COLUMN "lastChargedAt" TIMESTAMP(3),
    ADD COLUMN "chargeEndAt" TIMESTAMP(3);

CREATE INDEX "Deployment_status_nextChargeAt_idx" ON "Deployment"("status", "nextChargeAt");
CREATE INDEX "Deployment_chargeRelayerMode_idx" ON "Deployment"("chargeRelayerMode");
