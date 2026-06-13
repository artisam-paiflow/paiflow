-- Add a stable Soroban event id column so multiple same-kind events from one
-- transaction are preserved (e.g. splitter emits both `distrib` and `payout`).

-- Add as nullable first so existing rows don't fail.
ALTER TABLE "ContractEvent" ADD COLUMN "eventId" TEXT;

-- Backfill existing events with synthetic ids.
UPDATE "ContractEvent"
SET "eventId" = COALESCE(
  "txHash" || '-' || "kind"::text || '-' || "ledger"::text || '-' || EXTRACT(EPOCH FROM "occurredAt")::text,
  gen_random_uuid()::text
)
WHERE "eventId" IS NULL;

-- Make required and unique.
ALTER TABLE "ContractEvent" ALTER COLUMN "eventId" SET NOT NULL;
ALTER TABLE "ContractEvent" ADD CONSTRAINT "ContractEvent_eventId_key" UNIQUE ("eventId");

-- Remove the old constraint that collapsed same-kind events per tx.
ALTER TABLE "ContractEvent" DROP CONSTRAINT IF EXISTS "ContractEvent_txHash_kind_key";
