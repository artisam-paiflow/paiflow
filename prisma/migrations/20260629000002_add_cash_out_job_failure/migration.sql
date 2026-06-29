-- Dead-letter table for cash_out events where off-ramp job creation failed.
-- Operators can query this table and replay missed jobs.
CREATE TABLE "CashOutJobFailure" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deploymentId" UUID NOT NULL,
  "contractEventId" UUID NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "amountStroops" TEXT NOT NULL,
  "bankAccountName" TEXT NOT NULL,
  "bankAccountNumber" TEXT NOT NULL,
  "bankCode" TEXT NOT NULL,
  "error" TEXT,
  "retriedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CashOutJobFailure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashOutJobFailure_contractEventId_key" UNIQUE ("contractEventId"),
  CONSTRAINT "CashOutJobFailure_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CashOutJobFailure_contractEventId_fkey" FOREIGN KEY ("contractEventId") REFERENCES "ContractEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CashOutJobFailure_deploymentId_createdAt_idx" ON "CashOutJobFailure"("deploymentId", "createdAt");
