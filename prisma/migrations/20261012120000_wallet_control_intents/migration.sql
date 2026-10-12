CREATE TYPE "WalletControlState" AS ENUM ('PREPARED', 'SUBMITTING', 'SUCCESS', 'FAILED', 'EXPIRED');
CREATE TABLE "WalletControlIntent" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "maxTime" TEXT NOT NULL,
    "preparationLedger" INTEGER NOT NULL,
    "state" "WalletControlState" NOT NULL DEFAULT 'PREPARED',
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WalletControlIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletControlIntent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WalletControlIntent_txHash_key" ON "WalletControlIntent"("txHash");
CREATE INDEX "WalletControlIntent_deploymentId_network_nodeId_state_idx" ON "WalletControlIntent"("deploymentId", "network", "nodeId", "state");
