-- Durable retry scheduling is independent of signed-transaction analytics.
-- Existing PENDING rows, including completed admissions, are immediately due.
ALTER TABLE "ServiceTransaction"
  ADD COLUMN "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "checkAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ServiceTransaction_state_nextCheckAt_id_idx"
  ON "ServiceTransaction"("state", "nextCheckAt", "id");
