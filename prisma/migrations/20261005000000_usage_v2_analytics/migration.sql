-- CreateEnum
CREATE TYPE "AnalyticsAudience" AS ENUM ('INTERNAL', 'EXTERNAL', 'SANDBOX', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "TransactionOutcome" AS ENUM ('RECEIVED', 'ACCEPTED', 'UNRESOLVED', 'REJECTED', 'CONFIRMED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "analyticsAudience" "AnalyticsAudience" NOT NULL DEFAULT 'UNCLASSIFIED';

-- AlterTable
ALTER TABLE "SignedTransaction" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "apiTokenId" UUID,
ADD COLUMN     "audience" "AnalyticsAudience" NOT NULL DEFAULT 'UNCLASSIFIED',
ADD COLUMN     "callerAccountId" UUID,
ADD COLUMN     "checkAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ledger" INTEGER,
ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "outcome" "TransactionOutcome",
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "trackingVersion" TEXT;

-- CreateTable
CREATE TABLE "AnalyticsPolicy" (
    "version" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsPolicy_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "walletProvider" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "userId" UUID,
    "audience" "AnalyticsAudience" NOT NULL,
    "trackingVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDelivery" (
    "id" UUID NOT NULL,
    "distinctId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "personProfile" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletConnection_trackingVersion_network_audience_createdAt_idx" ON "WalletConnection"("trackingVersion", "network", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "WalletConnection_address_createdAt_idx" ON "WalletConnection"("address", "createdAt");

-- CreateIndex
CREATE INDEX "WalletConnection_userId_createdAt_idx" ON "WalletConnection"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsDelivery_deliveredAt_nextAttemptAt_idx" ON "AnalyticsDelivery"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SignedTransaction_callerAccountId_createdAt_idx" ON "SignedTransaction"("callerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "SignedTransaction_trackingVersion_network_audience_createdA_idx" ON "SignedTransaction"("trackingVersion", "network", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "SignedTransaction_outcome_nextCheckAt_idx" ON "SignedTransaction"("outcome", "nextCheckAt");

-- CreateIndex
CREATE INDEX "SignedTransaction_apiTokenId_createdAt_idx" ON "SignedTransaction"("apiTokenId", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletConnection" ADD CONSTRAINT "WalletConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedTransaction" ADD CONSTRAINT "SignedTransaction_callerAccountId_fkey" FOREIGN KEY ("callerAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedTransaction" ADD CONSTRAINT "SignedTransaction_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "DeploymentApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Activation is recorded by migration; historical rows are never backfilled.
INSERT INTO "AnalyticsPolicy" ("version", "activatedAt") VALUES ('usage-v2', CURRENT_TIMESTAMP);
