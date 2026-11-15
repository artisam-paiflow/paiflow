-- No activation, legacy registry migration, instance retrofit or financial rewrite.
BEGIN;
CREATE TABLE "ConditionalArtifactSet" (
  "network" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 2,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "receiveWasmHash" TEXT NOT NULL,
  "payerWasmHash" TEXT NOT NULL,
  "splitterWasmHash" TEXT NOT NULL,
  "routerWasmHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConditionalArtifactSet_pkey" PRIMARY KEY ("network", "version"),
  CONSTRAINT "ConditionalArtifactSet_network_check" CHECK ("network" IN ('testnet', 'mainnet')),
  CONSTRAINT "ConditionalArtifactSet_version_check" CHECK ("version" = 2),
  CONSTRAINT "ConditionalArtifactSet_hashes_check" CHECK (
    "receiveWasmHash" ~ '^[a-f0-9]{64}$' AND
    "payerWasmHash" ~ '^[a-f0-9]{64}$' AND
    "splitterWasmHash" ~ '^[a-f0-9]{64}$' AND
    "routerWasmHash" ~ '^[a-f0-9]{64}$'
  )
);
COMMIT;
