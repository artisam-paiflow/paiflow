-- Add decodedData column to ContractEvent for ABI-decoded structured payload
ALTER TABLE "ContractEvent" ADD COLUMN "decodedData" JSONB;

-- No need for unique constraint changes since decodedData is nullable