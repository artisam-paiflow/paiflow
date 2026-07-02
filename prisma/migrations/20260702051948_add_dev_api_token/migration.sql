-- CreateTable
CREATE TABLE "DevApiToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DevApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevApiToken_tokenHash_key" ON "DevApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DevApiToken_userId_idx" ON "DevApiToken"("userId");

-- AddForeignKey
ALTER TABLE "DevApiToken" ADD CONSTRAINT "DevApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
