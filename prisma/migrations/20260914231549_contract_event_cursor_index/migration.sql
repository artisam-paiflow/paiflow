-- CreateIndex
CREATE INDEX "ContractEvent_deploymentId_ledger_eventId_idx" ON "ContractEvent"("deploymentId", "ledger", "eventId");
