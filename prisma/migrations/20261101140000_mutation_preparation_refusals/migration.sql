CREATE TABLE "MutationPreparationRefusal" (
  "id" UUID NOT NULL,
  "deploymentId" UUID NOT NULL,
  "network" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "admin" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MutationPreparationRefusal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MutationPreparationRefusal_network_check" CHECK ("network" IN ('testnet', 'mainnet')),
  CONSTRAINT "MutationPreparationRefusal_hashes_check" CHECK (
    "idempotencyKeyHash" ~ '^[a-f0-9]{64}$' AND "requestDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "MutationPreparationRefusal_reason_check" CHECK (
    "reasonCode" IN ('VALIDATION', 'CONFLICT', 'UPSTREAM_RPC', 'INSUFFICIENT_FUNDS')
  ),
  CONSTRAINT "MutationPreparationRefusal_deploymentId_fkey" FOREIGN KEY ("deploymentId")
    REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MutationPreparationRefusal_deploymentId_network_key_key"
  ON "MutationPreparationRefusal"("deploymentId", "network", "idempotencyKeyHash");

CREATE FUNCTION "retain_mutation_preparation_refusal"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Mutation preparation refusal evidence is immutable and retained';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "retain_mutation_preparation_refusal"
  BEFORE UPDATE OR DELETE ON "MutationPreparationRefusal"
  FOR EACH ROW EXECUTE FUNCTION "retain_mutation_preparation_refusal"();
