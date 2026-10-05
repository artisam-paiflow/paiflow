-- CreateTable
CREATE TABLE "TransactionFeeBudget" (
    "network" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limitStroops" TEXT NOT NULL,
    "committedStroops" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionFeeBudget_pkey" PRIMARY KEY ("network","name")
);

-- CreateTable
CREATE TABLE "TransactionFeeReservation" (
    "id" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "budgetName" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "declaredFeeStroops" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionFeeReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionFeeReservation_network_budgetName_createdAt_idx" ON "TransactionFeeReservation"("network", "budgetName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionFeeReservation_network_txHash_key" ON "TransactionFeeReservation"("network", "txHash");

-- AddForeignKey
ALTER TABLE "TransactionFeeReservation" ADD CONSTRAINT "TransactionFeeReservation_network_budgetName_fkey" FOREIGN KEY ("network", "budgetName") REFERENCES "TransactionFeeBudget"("network", "name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep money canonical and nonnegative even if another writer bypasses TS.
ALTER TABLE "TransactionFeeBudget" ADD CONSTRAINT "TransactionFeeBudget_amounts_check"
CHECK ("limitStroops" ~ '^[1-9][0-9]{0,18}$'
  AND "committedStroops" ~ '^(0|[1-9][0-9]{0,18})$'
  AND "committedStroops"::NUMERIC <= "limitStroops"::NUMERIC);
ALTER TABLE "TransactionFeeReservation" ADD CONSTRAINT "TransactionFeeReservation_amount_check"
CHECK ("declaredFeeStroops" ~ '^[1-9][0-9]{0,18}$');
