-- #1141 targeted cleanup, authorized after the SELECT-only staging inventory.
-- Never deploy this migration against unexpected fiat/provider evidence.
-- Only empty bank fields in known Pay/Split graph configurations are removed.
-- Preserve every flow/deployment, crypto record, transaction hash, envelope,
-- admission/idempotency marker, financial outcome and ordinary event.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "Flow", "Deployment", "ContractTemplate", "TimelockRelease", "Employee", "ContractEvent", "OffRampPayoutJob", "CashOutJobFailure", "OffRampSenderProfile", "EmployeeBankDetail", "OffRampProviderCredential", "DeploymentWork", "ServiceTransaction" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.has_retired_financial_input(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_path_exists(value, '$.** ? (@.type == "cash_out" || @.kind == "cash_out" || @.templateKind == "CASH_OUT" || @.type == "cash_out_dev" || @.kind == "cash_out_dev" || @.templateKind == "CASH_OUT_DEV" || @.payoutMode == "fiat" || @.payoutMode == "FIAT" || @.isCashOut == true || @.is_cash_out == true)'), false)
$$;
CREATE FUNCTION pg_temp.has_retired_bank_metadata(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_path_exists(value, '$.** ? (exists(@.senderKyc) || exists(@.bankDetail) || exists(@.accountName) || exists(@.accountNumber) || exists(@.bankCode))'), false)
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OffRampPayoutJob")
    OR EXISTS (SELECT 1 FROM "CashOutJobFailure")
    OR EXISTS (SELECT 1 FROM "OffRampSenderProfile")
    OR EXISTS (SELECT 1 FROM "EmployeeBankDetail")
    OR EXISTS (SELECT 1 FROM "OffRampProviderCredential") THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: feature tables must be empty; reconcile and review unexpected records, never erase obligations (#1141)';
  END IF;
  IF EXISTS (SELECT 1 FROM "DeploymentWork" WHERE kind IN ('offramp-settlement','retirement-cash-out-recovery') OR kind LIKE 'offramp-settlement:%') THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: provider-specific durable work requires reconciliation, even when feature tables are empty (#1141)';
  END IF;
  IF EXISTS (SELECT 1 FROM "Flow" WHERE "templateKind"::text IN ('CASH_OUT','CASH_OUT_DEV') OR pg_temp.has_retired_financial_input(graph) OR pg_temp.has_retired_financial_input(parameters))
    OR EXISTS (SELECT 1 FROM "Deployment" WHERE "offRampEnabled" OR pg_temp.has_retired_financial_input("graphSnapshot") OR pg_temp.has_retired_financial_input("paramsSnapshot") OR pg_temp.has_retired_financial_input("pipelineSnapshot"))
    OR EXISTS (SELECT 1 FROM "Employee" WHERE "payoutMode"::text <> 'CRYPTO' OR "cashOutContractAddress" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "ContractEvent" WHERE kind::text IN ('CASH_OUT','CASH_OUT_DEV') OR payload #>> '{topics,0}' IN ('cash_out','cash_out_dev','bank_updated') OR pg_temp.has_retired_financial_input(payload) OR pg_temp.has_retired_financial_input("decodedData") OR pg_temp.has_retired_bank_metadata(payload) OR pg_temp.has_retired_bank_metadata("decodedData"))
    OR EXISTS (SELECT 1 FROM "TimelockRelease" WHERE "templateKind"::text IN ('CASH_OUT','CASH_OUT_DEV')) THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: actual fiat/cash-out evidence exists, regardless deployment status or retirement; preserve and reconcile it (#1141)';
  END IF;
  IF EXISTS (SELECT 1 FROM "DeploymentWork" WHERE kind IN ('offramp-settlement','retirement-cash-out-recovery') OR kind LIKE 'offramp-settlement:%') THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: provider-specific durable work requires reconciliation, even when feature tables are empty (#1141)';
  END IF;
  IF EXISTS (SELECT 1 FROM "Flow" WHERE pg_temp.has_retired_bank_metadata(parameters))
    OR EXISTS (SELECT 1 FROM "Deployment" WHERE pg_temp.has_retired_bank_metadata("paramsSnapshot") OR pg_temp.has_retired_bank_metadata("pipelineSnapshot")) THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: unexpected bank/KYC metadata in compiled parameters or pipeline snapshots (#1141)';
  END IF;
END $$;

CREATE FUNCTION pg_temp.strip_empty_bank_fields(config jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; result jsonb := config;
BEGIN
  IF jsonb_typeof(config) <> 'object' THEN RETURN config; END IF;
  FOREACH field IN ARRAY ARRAY['accountName','accountNumber','bankCode'] LOOP
    IF config ? field THEN
      IF jsonb_typeof(config -> field) <> 'string' OR btrim(config ->> field) <> '' THEN
        RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: nonempty or unexpected bank field; no destination may be changed (#1141)';
      END IF;
      result := result - field;
    END IF;
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.clean_retired_graph(graph jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; recipient jsonb; coordinate jsonb; recipients jsonb; nodes jsonb := '[]'::jsonb; result jsonb := graph;
BEGIN
  IF jsonb_typeof(graph -> 'nodes') = 'array' THEN
    FOR node IN SELECT value FROM jsonb_array_elements(graph -> 'nodes') LOOP
      IF node ->> 'type' = 'pay' AND jsonb_typeof(node -> 'config') = 'object' THEN
        node := jsonb_set(node, '{config}', pg_temp.strip_empty_bank_fields(node -> 'config'));
      ELSIF node ->> 'type' = 'split' AND jsonb_typeof(node #> '{config,recipients}') = 'array' THEN
        recipients := '[]'::jsonb;
        FOR recipient IN SELECT value FROM jsonb_array_elements(node #> '{config,recipients}') LOOP
          recipients := recipients || jsonb_build_array(pg_temp.strip_empty_bank_fields(recipient));
        END LOOP;
        node := jsonb_set(node, '{config,recipients}', recipients);
      END IF;
      nodes := nodes || jsonb_build_array(node);
    END LOOP;
    result := jsonb_set(graph, '{nodes}', nodes);
  END IF;
  -- Dictionary keys are arbitrary node IDs, not bank fields. Their VALUES
  -- remain subject to shape and retired-input checks; never exempt a subtree.
  IF jsonb_typeof(result) = 'object' AND result ? 'positions' THEN
    IF jsonb_typeof(result -> 'positions') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: malformed canvas positions (#1141)';
    END IF;
    FOR coordinate IN SELECT value FROM jsonb_each(result -> 'positions') LOOP
      IF jsonb_typeof(coordinate) IS DISTINCT FROM 'object'
        OR jsonb_typeof(coordinate -> 'x') IS DISTINCT FROM 'number'
        OR jsonb_typeof(coordinate -> 'y') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: malformed canvas coordinate value (#1141)';
      END IF;
      IF pg_temp.has_retired_bank_metadata(coordinate) OR pg_temp.has_retired_financial_input(coordinate) THEN
        RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: retired metadata inside canvas coordinate values (#1141)';
      END IF;
    END LOOP;
  END IF;
  IF pg_temp.has_retired_bank_metadata(CASE WHEN jsonb_typeof(result)='object' THEN result - 'positions' ELSE result END) THEN
    RAISE EXCEPTION 'Targeted off-ramp cleanup blocked: bank/KYC metadata outside supported empty Pay/Split fields (#1141)';
  END IF;
  RETURN result;
END $$;

-- Version current drafts and audit the blank-only change without copying PII.
WITH cleaned AS MATERIALIZED (
  SELECT id, pg_temp.clean_retired_graph(graph) AS graph FROM "Flow"
), updated AS (
  UPDATE "Flow" f SET graph=c.graph, version=f.version+1, "updatedAt"=CURRENT_TIMESTAMP
  FROM cleaned c WHERE f.id=c.id AND f.graph IS DISTINCT FROM c.graph
  RETURNING f.id,f.version
)
INSERT INTO "AuditLog" (id,action,metadata,"createdAt")
SELECT gen_random_uuid(),'OFFRAMP_EMPTY_METADATA_REMOVED',jsonb_build_object(
  'flowId',id,'migration','20261029090000_retire_offramp','scope','Flow.graph',
  'version',version,'reason','Remove only empty retired Pay/Split bank fields; crypto meaning unchanged (#1141)'
),CURRENT_TIMESTAMP FROM updated;

-- Explicit narrow snapshot-normalization exception: only blank bank keys,
-- audited per deployment. Signed/unsigned bytes, hashes and finality are intact.
WITH cleaned AS MATERIALIZED (
  SELECT id, pg_temp.clean_retired_graph("graphSnapshot") AS graph FROM "Deployment"
), updated AS (
  UPDATE "Deployment" d SET "graphSnapshot"=c.graph
  FROM cleaned c WHERE d.id=c.id AND d."graphSnapshot" IS DISTINCT FROM c.graph
  RETURNING d.id
)
INSERT INTO "AuditLog" (id,action,metadata,"createdAt")
SELECT gen_random_uuid(),'OFFRAMP_EMPTY_METADATA_REMOVED',jsonb_build_object(
  'deploymentId',id,'migration','20261029090000_retire_offramp','scope','Deployment.graphSnapshot',
  'reason','Remove only empty retired Pay/Split bank fields; transaction bytes and financial evidence unchanged (#1141)'
),CURRENT_TIMESTAMP FROM updated;

-- All feature tables were proved empty under the migration locks. No cascade
-- deletion is used: an unexpected dependency blocks the entire transaction.
DROP TABLE "OffRampPayoutJob";
DROP TABLE "CashOutJobFailure";
DROP TABLE "OffRampSenderProfile";
DROP TABLE "EmployeeBankDetail";
DROP TABLE "OffRampProviderCredential";
ALTER TABLE "Deployment" DROP COLUMN "offRampEnabled";
ALTER TABLE "Employee" DROP COLUMN "cashOutContractAddress", DROP COLUMN "payoutMode";
DROP TYPE "OffRampJobSource";
DROP TYPE "OffRampPayoutJobStatus";
DROP TYPE "EmployeePayoutMode";

DELETE FROM "ContractTemplate" WHERE kind::text IN ('CASH_OUT','CASH_OUT_DEV');
ALTER TYPE "TemplateKind" RENAME TO "TemplateKind_with_offramp";
CREATE TYPE "TemplateKind" AS ENUM ('SPLITTER','STREAMER','CONDITIONAL','DEPOSIT_TRIGGER','ROUTER','TIMELOCK','FACTORY','WEBHOOK','SUBSCRIPTION','ORACLE','MULTISIG','SWAPPER','YIELD','PAYER','PAYROLL','TIMELOCK_BRANCH');
ALTER TABLE "Flow" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
ALTER TABLE "ContractTemplate" ALTER COLUMN kind TYPE "TemplateKind" USING kind::text::"TemplateKind";
ALTER TABLE "TimelockRelease" ALTER COLUMN "templateKind" TYPE "TemplateKind" USING "templateKind"::text::"TemplateKind";
DROP TYPE "TemplateKind_with_offramp";
ALTER TYPE "EventKind" RENAME TO "EventKind_with_offramp";
CREATE TYPE "EventKind" AS ENUM ('RECEIVE','PAYOUT','CLAIM','STATUS_CHANGE','CANCEL','SHORTFALL','PAUSE','RESUME','FORWARD','RETRIEVE','ALLOWANCE','RECIPIENT_UPDATED');
ALTER TABLE "ContractEvent" ALTER COLUMN kind TYPE "EventKind" USING kind::text::"EventKind";
DROP TYPE "EventKind_with_offramp";
DROP FUNCTION pg_temp.clean_retired_graph(jsonb);
DROP FUNCTION pg_temp.strip_empty_bank_fields(jsonb);
DROP FUNCTION pg_temp.has_retired_bank_metadata(jsonb);
DROP FUNCTION pg_temp.has_retired_financial_input(jsonb);
COMMIT;
