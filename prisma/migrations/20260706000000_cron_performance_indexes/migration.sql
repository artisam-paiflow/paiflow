-- Composite index to speed the auto-charge-subscriptions deployment lookup
-- (status + chargeRelayerMode + nextChargeAt).
CREATE INDEX "Deployment_status_chargeRelayerMode_nextChargeAt_idx"
  ON "Deployment" ("status", "chargeRelayerMode", "nextChargeAt");

-- Composite index to speed the off-ramp due-job lookup
-- (status + runAt + lockedAt).
CREATE INDEX "OffRampPayoutJob_status_runAt_lockedAt_idx"
  ON "OffRampPayoutJob" ("status", "runAt", "lockedAt");

-- Composite index to speed deployment-scoped off-ramp queries and cancellation.
CREATE INDEX "OffRampPayoutJob_deploymentId_status_idx"
  ON "OffRampPayoutJob" ("deploymentId", "status");
