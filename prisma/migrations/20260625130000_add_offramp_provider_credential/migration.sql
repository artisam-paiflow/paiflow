-- CreateTable
CREATE TABLE "OffRampProviderCredential" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "idToken" TEXT,
    "refreshToken" TEXT,
    "apiUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OffRampProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OffRampProviderCredential_provider_key" ON "OffRampProviderCredential"("provider");
