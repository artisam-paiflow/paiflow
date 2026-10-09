-- Preserve all existing local passwords; Google-created accounts have none.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
CREATE TABLE "GoogleIdentity" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "providerAccountId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleIdentity_provider_providerAccountId_key" ON "GoogleIdentity"("provider", "providerAccountId");
CREATE UNIQUE INDEX "GoogleIdentity_userId_provider_key" ON "GoogleIdentity"("userId", "provider");
ALTER TABLE "GoogleIdentity" ADD CONSTRAINT "GoogleIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "GoogleLinkIntent" (
  "id" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleLinkIntent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleLinkIntent_tokenHash_key" ON "GoogleLinkIntent"("tokenHash");
CREATE INDEX "GoogleLinkIntent_userId_idx" ON "GoogleLinkIntent"("userId");
CREATE INDEX "GoogleLinkIntent_expiresAt_idx" ON "GoogleLinkIntent"("expiresAt");
ALTER TABLE "GoogleLinkIntent" ADD CONSTRAINT "GoogleLinkIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
