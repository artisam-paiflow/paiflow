-- Add a unique constraint on PayrollRun.txHash so retries of
-- payroll-record-run are idempotent.
CREATE UNIQUE INDEX "PayrollRun_txHash_key" ON "PayrollRun"("txHash");
