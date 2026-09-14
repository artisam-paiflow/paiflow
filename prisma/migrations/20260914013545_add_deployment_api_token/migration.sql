-- CreateTable
CREATE TABLE "DeploymentApiToken" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "createdById" UUID,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeploymentApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentApiToken_tokenHash_key" ON "DeploymentApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeploymentApiToken_deploymentId_idx" ON "DeploymentApiToken"("deploymentId");

-- AddForeignKey
ALTER TABLE "DeploymentApiToken" ADD CONSTRAINT "DeploymentApiToken_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApiToken" ADD CONSTRAINT "DeploymentApiToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
