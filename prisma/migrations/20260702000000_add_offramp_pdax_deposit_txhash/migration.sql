-- Idempotency guard for the native-XLM -> PDAX off-ramp deposit.
-- Persisting the deposit tx hash lets process-offramp-jobs detect an
-- already-completed deposit on retry and avoid double-depositing funds.
ALTER TABLE "OffRampPayoutJob" ADD COLUMN "pdaxDepositTxHash" TEXT;
