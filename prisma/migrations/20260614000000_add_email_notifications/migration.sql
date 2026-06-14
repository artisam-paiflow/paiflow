-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" UUID NOT NULL,
    "contractEventId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailNotification_contractEventId_idx" ON "EmailNotification"("contractEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailNotification_contractEventId_nodeId_recipient_key" ON "EmailNotification"("contractEventId", "nodeId", "recipient");

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_contractEventId_fkey" FOREIGN KEY ("contractEventId") REFERENCES "ContractEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
