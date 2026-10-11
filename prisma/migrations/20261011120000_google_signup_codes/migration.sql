CREATE TABLE "GoogleSignupCode" (
  "id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "GoogleSignupCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleSignupCode_codeHash_key" ON "GoogleSignupCode"("codeHash");
CREATE TABLE "GoogleSignupIntent" (
  "id" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "codeId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleSignupIntent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleSignupIntent_tokenHash_key" ON "GoogleSignupIntent"("tokenHash");
CREATE INDEX "GoogleSignupIntent_expiresAt_idx" ON "GoogleSignupIntent"("expiresAt");
CREATE INDEX "GoogleSignupIntent_codeId_idx" ON "GoogleSignupIntent"("codeId");
ALTER TABLE "GoogleSignupIntent" ADD CONSTRAINT "GoogleSignupIntent_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "GoogleSignupCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
