-- #1144 permanently retires payroll application support. This migration may
-- remove only empty payroll storage, unused template configuration and the
-- single explicitly authorized, unchanged, undeployed draft. Opaque identity
-- and content fingerprints bind that authorization without publishing its ID
-- or configuration. They are equality guards, not cryptographic proofs.
-- Preserve audit records, ordinary payment labels, snapshots and all financial
-- evidence. An unexpected target must fail and receive a separate review.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "Flow", "Deployment", "ContractTemplate", "TimelockRelease",
  "Employee", "PayrollRun", "PayrollPayout", "ContractEvent", "AuditLog",
  "DeploymentWork", "ServiceTransaction", "SignedTransaction", "EventCursor"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.has_retired_payroll_input(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_path_exists(value,
    '$.** ? (@.type == "payroll" || @.type == "payroll_dev" || @.kind == "payroll" || @.kind == "payroll_trigger" || @.kind == "payroll_trigger_dev" || @.kind == "payroll_dev" || @.templateKind == "PAYROLL" || @.templateKind == "PAYROLL_DEV")'), false)
$$;

DO $$
BEGIN
  -- Payroll status is not settlement evidence. Even a FAILED/CANCELLED run or
  -- an unused employee prevents table removal until its disposition is reviewed.
  IF EXISTS (SELECT 1 FROM "Employee")
    OR EXISTS (SELECT 1 FROM "PayrollRun")
    OR EXISTS (SELECT 1 FROM "PayrollPayout") THEN
    RAISE EXCEPTION 'Payroll retirement blocked: payroll storage must be empty; preserve and review unexpected financial or roster records (#1144)';
  END IF;

  -- Detect both legacy monolithic PAYROLL and current payroll graphs compiled
  -- to ordinary SUBSCRIPTION + PAYER/SPLITTER. Include every deployment status
  -- and service lifecycle state, not just CONFIRMED/ACTIVE rows.
  IF EXISTS (
    SELECT 1 FROM "Deployment" d JOIN "Flow" f ON f.id=d."flowId"
    WHERE f."templateKind"::text IN ('PAYROLL','PAYROLL_DEV')
      OR pg_temp.has_retired_payroll_input(f.graph)
      OR pg_temp.has_retired_payroll_input(f.parameters)
      OR pg_temp.has_retired_payroll_input(d."graphSnapshot")
      OR pg_temp.has_retired_payroll_input(d."paramsSnapshot")
      OR pg_temp.has_retired_payroll_input(d."pipelineSnapshot")
      OR md5(f.id::text)='4f8cbf87d1790d1afb8c8032b40155c7'
  ) THEN
    RAISE EXCEPTION 'Payroll retirement blocked: a payroll deployment or authorized draft deployment exists, regardless status; reconcile and review its financial evidence (#1144)';
  END IF;

  IF EXISTS (SELECT 1 FROM "TimelockRelease" WHERE "templateKind"::text IN ('PAYROLL','PAYROLL_DEV'))
    OR EXISTS (SELECT 1 FROM "DeploymentWork" WHERE kind ILIKE '%payroll%')
    OR EXISTS (SELECT 1 FROM "ContractEvent" WHERE pg_temp.has_retired_payroll_input(payload) OR pg_temp.has_retired_payroll_input("decodedData"))
    OR EXISTS (SELECT 1 FROM "SignedTransaction" WHERE kind::text ILIKE '%payroll%')
    OR EXISTS (SELECT 1 FROM "AuditLog" WHERE action ILIKE '%payroll%' OR pg_temp.has_retired_payroll_input(metadata)) THEN
    RAISE EXCEPTION 'Payroll retirement blocked: payroll work or retained evidence requires separate review; unknown outcomes must never be erased (#1144)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Flow"
    WHERE ("templateKind"::text IN ('PAYROLL','PAYROLL_DEV')
      OR pg_temp.has_retired_payroll_input(graph)
      OR pg_temp.has_retired_payroll_input(parameters))
      AND md5(id::text)<>'4f8cbf87d1790d1afb8c8032b40155c7'
  ) THEN
    RAISE EXCEPTION 'Payroll retirement blocked: an unexpected payroll flow exists; only the explicitly authorized draft may be deleted (#1144)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Flow"
    WHERE md5(id::text)='4f8cbf87d1790d1afb8c8032b40155c7'
      AND (version<>12 OR "templateKind"::text<>'SPLITTER'
        OR md5(graph::text)<>'38b4a4b922dff127111e6efc2b70d93a'
        OR md5(parameters::text)<>'5c2731fcdc9c09af07edf7aeab6e5f91')
  ) THEN
    RAISE EXCEPTION 'Payroll retirement blocked: the authorized draft changed since inventory; preserve it and review fresh evidence (#1144)';
  END IF;
END $$;

-- Ordinary FK restrictions remain the final no-deployment guard. AuditLog has
-- no cascading Flow relation: preserve every original create/update record and
-- record the narrow deletion without copying graph or personal information.
WITH removed AS (
  DELETE FROM "Flow"
  WHERE md5(id::text)='4f8cbf87d1790d1afb8c8032b40155c7'
    AND version=12 AND "templateKind"::text='SPLITTER'
    AND md5(graph::text)='38b4a4b922dff127111e6efc2b70d93a'
    AND md5(parameters::text)='5c2731fcdc9c09af07edf7aeab6e5f91'
    AND NOT EXISTS (SELECT 1 FROM "Deployment" WHERE "flowId"="Flow".id)
  RETURNING id,version
)
INSERT INTO "AuditLog" (id,action,metadata,"createdAt")
SELECT gen_random_uuid(),'PAYROLL_UNDEPLOYED_DRAFT_REMOVED',
  jsonb_build_object('flowId',id,'version',version,
    'migration','20261029150000_retire_payroll',
    'reason','Explicitly authorized removal of unchanged undeployed payroll draft (#1144)'),
  CURRENT_TIMESTAMP FROM removed;

-- All storage is verified empty while writes are fenced. No CASCADE deletion
-- or terminal-status fabrication is permitted.
DROP TABLE "PayrollPayout";
DROP TABLE "PayrollRun";
DROP TABLE "Employee";
DROP TYPE "PayrollRunStatus";
DELETE FROM "ContractTemplate" WHERE kind::text='PAYROLL';
ALTER TYPE "TemplateKind" RENAME TO "TemplateKind_with_payroll";
CREATE TYPE "TemplateKind" AS ENUM ('SPLITTER','STREAMER','CONDITIONAL','DEPOSIT_TRIGGER','ROUTER','TIMELOCK','FACTORY','WEBHOOK','SUBSCRIPTION','ORACLE','MULTISIG','SWAPPER','YIELD','PAYER','TIMELOCK_BRANCH');
ALTER TABLE "Flow" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
ALTER TABLE "ContractTemplate" ALTER COLUMN kind TYPE "TemplateKind" USING kind::text::"TemplateKind";
ALTER TABLE "TimelockRelease" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
DROP TYPE "TemplateKind_with_payroll";
DROP FUNCTION pg_temp.has_retired_payroll_input(jsonb);
COMMIT;
