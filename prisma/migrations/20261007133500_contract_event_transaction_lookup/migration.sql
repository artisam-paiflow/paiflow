-- Deployment-scoped transaction status attribution lookup.
CREATE INDEX "ContractEvent_deploymentId_txHash_idx" ON "ContractEvent"("deploymentId", "txHash");
