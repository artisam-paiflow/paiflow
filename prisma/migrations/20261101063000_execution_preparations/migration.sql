-- Extend the existing durable wallet-intent lifecycle. No signed XDR or keys.
ALTER TABLE "WalletControlIntent"
  ADD COLUMN "unsignedXdr" TEXT,
  ADD COLUMN "executionIntent" JSONB,
  ADD COLUMN "executionArtifacts" JSONB,
  ADD COLUMN "idempotencyKeyHash" TEXT,
  ADD COLUMN "requestDigest" TEXT;

CREATE UNIQUE INDEX "WalletControlIntent_deploymentId_network_idempotencyKeyHash_key"
  ON "WalletControlIntent"("deploymentId", "network", "idempotencyKeyHash");
CREATE INDEX "WalletControlIntent_execution_payer_state_idx"
  ON "WalletControlIntent"("deploymentId", "network", "action", "walletAddress", "state");
