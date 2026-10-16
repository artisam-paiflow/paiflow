-- CreateEnum
CREATE TYPE "DeveloperTokenPermission" AS ENUM ('READ_ONLY', 'READ_OPERATE');

-- AlterTable
ALTER TABLE "SignedTransaction" ADD COLUMN     "developerApiTokenId" UUID;

-- CreateTable
CREATE TABLE "DeveloperApiToken" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT,
    "permission" "DeveloperTokenPermission" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeveloperApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperTokenGrant" (
    "tokenId" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,

    CONSTRAINT "DeveloperTokenGrant_pkey" PRIMARY KEY ("tokenId","deploymentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeveloperApiToken_tokenHash_key" ON "DeveloperApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeveloperApiToken_ownerId_id_idx" ON "DeveloperApiToken"("ownerId", "id");

-- CreateIndex
CREATE INDEX "DeveloperTokenGrant_deploymentId_idx" ON "DeveloperTokenGrant"("deploymentId");

-- CreateIndex
CREATE INDEX "Deployment_ownerId_status_serviceState_id_idx" ON "Deployment"("ownerId", "status", "serviceState", "id");

-- CreateIndex
CREATE INDEX "SignedTransaction_developerApiTokenId_createdAt_idx" ON "SignedTransaction"("developerApiTokenId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeveloperApiToken" ADD CONSTRAINT "DeveloperApiToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperTokenGrant" ADD CONSTRAINT "DeveloperTokenGrant_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "DeveloperApiToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperTokenGrant" ADD CONSTRAINT "DeveloperTokenGrant_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedTransaction" ADD CONSTRAINT "SignedTransaction_developerApiTokenId_fkey" FOREIGN KEY ("developerApiTokenId") REFERENCES "DeveloperApiToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

