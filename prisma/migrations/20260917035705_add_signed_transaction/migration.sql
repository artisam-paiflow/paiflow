-- CreateEnum
CREATE TYPE "SignedTxKind" AS ENUM ('DEPLOY', 'TRIGGER', 'INVOKE', 'API_EXECUTE');

-- CreateTable
CREATE TABLE "SignedTransaction" (
    "id" UUID NOT NULL,
    "txHash" TEXT NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "feeSourceAddress" TEXT,
    "muxedSource" TEXT,
    "isFeeBump" BOOLEAN NOT NULL DEFAULT false,
    "signedBySource" BOOLEAN NOT NULL DEFAULT true,
    "userId" UUID,
    "deploymentId" UUID,
    "kind" "SignedTxKind" NOT NULL,
    "network" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignedTransaction_txHash_key" ON "SignedTransaction"("txHash");

-- CreateIndex
CREATE INDEX "SignedTransaction_signerAddress_createdAt_idx" ON "SignedTransaction"("signerAddress", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SignedTransaction_userId_createdAt_idx" ON "SignedTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SignedTransaction_deploymentId_createdAt_idx" ON "SignedTransaction"("deploymentId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SignedTransaction" ADD CONSTRAINT "SignedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedTransaction" ADD CONSTRAINT "SignedTransaction_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
