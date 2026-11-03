-- Add exact-hash preparation evidence without modifying historical transactions.
CREATE TABLE "WalletSubmissionPreparation" (
    "txHash" TEXT NOT NULL,
    "deploymentId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "kind" "SignedTxKind" NOT NULL,
    "sourceAddress" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountStroops" TEXT,
    "maxTime" TEXT NOT NULL,
    "snapshotDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletSubmissionPreparation_pkey" PRIMARY KEY ("txHash"),
    CONSTRAINT "WalletSubmissionPreparation_kind_check" CHECK ("kind" IN ('TRIGGER', 'INVOKE'))
);

CREATE INDEX "WalletSubmissionPreparation_deploymentId_createdAt_idx"
    ON "WalletSubmissionPreparation"("deploymentId", "createdAt");
CREATE INDEX "WalletSubmissionPreparation_network_createdAt_idx"
    ON "WalletSubmissionPreparation"("network", "createdAt");

ALTER TABLE "WalletSubmissionPreparation"
    ADD CONSTRAINT "WalletSubmissionPreparation_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
