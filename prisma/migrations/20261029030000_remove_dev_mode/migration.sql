-- #1138: remove mutable-flow authoring without altering deployment evidence.
-- The live beta inventory found no dev deployments. Refuse cutover on a
-- different database if removing runtime support would abandon one.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "Flow", "Deployment", "ContractTemplate", "DevApiToken", "TimelockRelease" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Deployment" d
    WHERE d."graphSnapshot"::jsonb -> 'devMode' = 'true'::jsonb
       -- Match parameter discriminants, never ordinary node IDs or bank names.
       OR jsonb_path_exists(
         d."paramsSnapshot"::jsonb,
         '$.**.kind ? (@ == "payer_dev" || @ == "splitter_dev" || @ == "subscription_dev_trigger" || @ == "cash_out_dev")'
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(d."pipelineSnapshot"::jsonb) = 'array'
             THEN d."pipelineSnapshot"::jsonb ELSE '[]'::jsonb END
         ) n WHERE n ->> 'templateKind' IN ('PAYER_DEV','SPLITTER_DEV','SUBSCRIPTION_DEV','CASH_OUT_DEV')
       )
  ) THEN
    RAISE EXCEPTION 'Dev-mode deployment evidence exists; reconcile its obligations before removing runtime support (#1138)';
  END IF;
END $$;

-- A flow with deployment history must keep its parent row. Delete only
-- undeployed dev drafts; deployment admission and deletion cannot race the lock.
WITH removed AS (
  DELETE FROM "Flow" f
  WHERE f.graph::jsonb -> 'devMode' = 'true'::jsonb
    AND NOT EXISTS (SELECT 1 FROM "Deployment" d WHERE d."flowId" = f.id)
  RETURNING id, "ownerId"
)
INSERT INTO "AuditLog" (id, "userId", action, metadata, "createdAt")
SELECT gen_random_uuid(), "ownerId", 'FLOW_DELETE',
  jsonb_build_object('flowId', id, 'reason', 'Dev mode removed (#1138)'), CURRENT_TIMESTAMP
FROM removed;

-- Strip retired settings from CURRENT graphs only. Preserve every other edit
-- and leave missing values to standard validation; never restore a snapshot.
WITH cleaned AS (
  SELECT f.id,
    (f.graph::jsonb - 'devMode') ||
    CASE WHEN jsonb_typeof(f.graph::jsonb -> 'nodes') = 'array' THEN
      jsonb_build_object('nodes', COALESCE((
        SELECT jsonb_agg(
          CASE WHEN jsonb_typeof(n -> 'config') = 'object' THEN
            jsonb_set(n, '{config}', (n -> 'config') - 'fillValueViaApi' - 'fillScheduleViaApi')
          ELSE n END ORDER BY ordinal
        ) FROM jsonb_array_elements(f.graph::jsonb -> 'nodes') WITH ORDINALITY AS node(n, ordinal)
      ), '[]'::jsonb))
    ELSE '{}'::jsonb END AS graph
  FROM "Flow" f
), updated AS (
  UPDATE "Flow" f SET graph = c.graph, version = f.version + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM cleaned c WHERE f.id = c.id AND f.graph::jsonb IS DISTINCT FROM c.graph
  RETURNING f.id, f."ownerId"
)
INSERT INTO "AuditLog" (id, "userId", action, metadata, "createdAt")
SELECT gen_random_uuid(), "ownerId", 'FLOW_UPDATE',
  jsonb_build_object('flowId', id, 'reason', 'Dev settings removed; standard validation applies (#1138)'), CURRENT_TIMESTAMP
FROM updated;

-- Retired machine credentials cannot authenticate any route after this change.
-- Keep their records in a database-only evidence table; hashes are never exposed.
WITH revoked AS (
  UPDATE "DevApiToken" SET "revokedAt" = CURRENT_TIMESTAMP
  WHERE "revokedAt" IS NULL
  RETURNING id, "userId"
)
INSERT INTO "AuditLog" (id, "userId", action, metadata, "createdAt")
SELECT gen_random_uuid(), "userId", 'API_TOKEN_REVOKED',
  jsonb_build_object('tokenId', id, 'reason', 'Legacy machine credential retired (#1138)'), CURRENT_TIMESTAMP
FROM revoked;
ALTER TABLE "DevApiToken" RENAME TO "RetiredDevApiToken";

DELETE FROM "ContractTemplate" WHERE kind::text IN ('PAYER_DEV','SPLITTER_DEV','SUBSCRIPTION_DEV','CASH_OUT_DEV');
-- Flow kinds must already describe standard graphs after draft cleanup. Do not
-- silently relabel an unexplained persisted kind in an uninspected environment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Flow" WHERE "templateKind"::text IN ('PAYER_DEV','SPLITTER_DEV','SUBSCRIPTION_DEV','CASH_OUT_DEV')) OR EXISTS (SELECT 1 FROM "TimelockRelease" WHERE "templateKind"::text IN ('PAYER_DEV','SPLITTER_DEV','SUBSCRIPTION_DEV','CASH_OUT_DEV')) THEN
    RAISE EXCEPTION 'Unexpected retained dev template kind; inspect the current flow before cutover (#1138)';
  END IF;
END $$;
ALTER TYPE "TemplateKind" RENAME TO "TemplateKind_old";
CREATE TYPE "TemplateKind" AS ENUM ('SPLITTER','STREAMER','CONDITIONAL','DEPOSIT_TRIGGER','ROUTER','TIMELOCK','FACTORY','WEBHOOK','SUBSCRIPTION','ORACLE','MULTISIG','SWAPPER','YIELD','PAYER','PAYROLL','CASH_OUT','TIMELOCK_BRANCH');
ALTER TABLE "Flow" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
ALTER TABLE "ContractTemplate" ALTER COLUMN kind TYPE "TemplateKind" USING kind::text::"TemplateKind";
ALTER TABLE "TimelockRelease" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
DROP TYPE "TemplateKind_old";
COMMIT;
