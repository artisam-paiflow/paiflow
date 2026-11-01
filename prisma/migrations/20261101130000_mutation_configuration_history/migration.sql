ALTER TABLE "WalletControlIntent" ADD COLUMN "mutationIntent" JSONB;
CREATE TABLE "ConfigurationHistory" (
 "id" UUID NOT NULL,
 "deploymentId" UUID NOT NULL,
 "network" TEXT NOT NULL,
 "nodeId" TEXT NOT NULL,
 "contractAddress" TEXT NOT NULL,
 "revision" TEXT NOT NULL,
 "configuration" JSONB NOT NULL,
 "contentHash" TEXT NOT NULL,
 "observedLedger" INTEGER NOT NULL,
 "eventLedger" INTEGER,
 "eventId" TEXT,
 "txHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConfigurationHistory_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ConfigurationHistory_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConfigurationHistory_eventId_key" ON "ConfigurationHistory"("eventId");
CREATE UNIQUE INDEX "ConfigurationHistory_deploymentId_network_nodeId_revision_key" ON "ConfigurationHistory"("deploymentId", "network", "nodeId", "revision");
CREATE INDEX "ConfigurationHistory_deploymentId_network_observedLedger_id_idx" ON "ConfigurationHistory"("deploymentId", "network", "observedLedger", "id");
-- Evidence may gain a matching event receipt, but confirmed terms cannot be rewritten.
-- Restrictive deployment FK prevents cascading retirement/deletion of this history.
CREATE FUNCTION protect_configuration_history() RETURNS trigger AS $$
BEGIN
 IF NEW."deploymentId" IS DISTINCT FROM OLD."deploymentId" OR NEW."network" IS DISTINCT FROM OLD."network"
 OR NEW."nodeId" IS DISTINCT FROM OLD."nodeId" OR NEW."contractAddress" IS DISTINCT FROM OLD."contractAddress"
 OR NEW."revision" IS DISTINCT FROM OLD."revision" OR NEW."configuration" IS DISTINCT FROM OLD."configuration"
 OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR NEW."observedLedger" IS DISTINCT FROM OLD."observedLedger"
 OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
 OR (OLD."eventId" IS NOT NULL AND NEW."eventId" IS DISTINCT FROM OLD."eventId")
 OR (OLD."eventLedger" IS NOT NULL AND NEW."eventLedger" IS DISTINCT FROM OLD."eventLedger")
 OR (OLD."txHash" IS NOT NULL AND NEW."txHash" IS DISTINCT FROM OLD."txHash") THEN
 RAISE EXCEPTION 'Configuration history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ConfigurationHistory_immutable" BEFORE UPDATE ON "ConfigurationHistory"
FOR EACH ROW EXECUTE FUNCTION protect_configuration_history();
