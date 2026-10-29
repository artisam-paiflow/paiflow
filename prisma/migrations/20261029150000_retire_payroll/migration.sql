-- Corrective pre-staging exception for #1144/#1146. See docs/payroll-retirement.md.
-- Retire runtime support without deleting/reclassifying historical financial data.
-- This exact, independently verified cancelled TESTNET fixture is the ONLY
-- deployed-payroll exception. Changed or additional obligations must stop rollout.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE "Flow", "Deployment", "ContractTemplate", "TimelockRelease",
  "Employee", "PayrollRun", "PayrollPayout", "ContractEvent", "AuditLog",
  "DeploymentWork", "ServiceTransaction", "SignedTransaction", "EventCursor",
  "WalletControlIntent", "StreamerClaimJob"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.has_retired_payroll_input(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_path_exists(value,
    '$.** ? (@.type == "payroll" || @.type == "payroll_dev" || @.kind == "payroll" || @.kind == "payroll_trigger" || @.kind == "payroll_trigger_dev" || @.kind == "payroll_dev" || @.templateKind == "PAYROLL" || @.templateKind == "PAYROLL_DEV")'), false)
$$;

DO $$
BEGIN
  -- Bound to the reviewed immutable flow and deployment intent. IDs alone,
  -- status alone, cancellation, or a clock timeout never authorize this case.
  IF EXISTS (SELECT 1 FROM "Flow" WHERE md5(id::text)='36d248bcfacfdd320b21c8446eb559e4')
    OR EXISTS (SELECT 1 FROM "Deployment" WHERE md5(id::text)='a64cbd2220d7dff53b89d23bd86f7a4c') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Flow" f JOIN "Deployment" d ON d."flowId"=f.id
      WHERE md5(f.id::text)='36d248bcfacfdd320b21c8446eb559e4'
        AND md5(d.id::text)='a64cbd2220d7dff53b89d23bd86f7a4c'
        AND md5(jsonb_build_object('id',f.id,'version',f.version,'templateKind',f."templateKind",'graph',f.graph,'parameters',f.parameters)::text)='4c2f87d4d8eaacd22764cc19ffa0665b'
        AND md5(jsonb_build_object('id',d.id,'flowId',d."flowId",'ownerId',d."ownerId",'network',d.network,'sourceAccount',d."sourceAccount",'deployTxHash',d."deployTxHash",'graphSnapshot',d."graphSnapshot",'paramsSnapshot',d."paramsSnapshot",'pipelineSnapshot',d."pipelineSnapshot")::text)='3d7b7420f18c84b43fd653f88ccc3ddd'
        AND d.network='testnet' AND d.status='CONFIRMED'
        AND d."serviceState"='ACTIVE' AND d."chargeRelayerMode"='MANUAL'
        AND d."lastChargedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'Payroll preservation blocked: reviewed fixture identity or intent changed (#1144)';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Deployment" d JOIN "Flow" f ON f.id=d."flowId"
    WHERE (f."templateKind"::text IN ('PAYROLL','PAYROLL_DEV')
      OR pg_temp.has_retired_payroll_input(f.graph)
      OR pg_temp.has_retired_payroll_input(f.parameters)
      OR pg_temp.has_retired_payroll_input(d."graphSnapshot")
      OR pg_temp.has_retired_payroll_input(d."paramsSnapshot")
      OR pg_temp.has_retired_payroll_input(d."pipelineSnapshot"))
      AND md5(d.id::text)<>'a64cbd2220d7dff53b89d23bd86f7a4c'
  ) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unreviewed payroll deployment (#1144)';
  END IF;

  -- Keep the previously reviewed undeployed draft unchanged too. Cleanup is
  -- deferred; there is no DELETE, enum cast or table drop in this migration.
  IF EXISTS (
    SELECT 1 FROM "Flow" f
    WHERE (f."templateKind"::text IN ('PAYROLL','PAYROLL_DEV')
      OR pg_temp.has_retired_payroll_input(f.graph)
      OR pg_temp.has_retired_payroll_input(f.parameters))
      AND md5(f.id::text) NOT IN ('36d248bcfacfdd320b21c8446eb559e4','4f8cbf87d1790d1afb8c8032b40155c7')
  ) OR EXISTS (
    SELECT 1 FROM "Flow" f WHERE md5(f.id::text)='4f8cbf87d1790d1afb8c8032b40155c7'
      AND (f.version<>12 OR f."templateKind"::text<>'SPLITTER'
        OR md5(f.graph::text)<>'38b4a4b922dff127111e6efc2b70d93a'
        OR md5(f.parameters::text)<>'5c2731fcdc9c09af07edf7aeab6e5f91'
        OR EXISTS (SELECT 1 FROM "Deployment" d WHERE d."flowId"=f.id))
  ) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unreviewed or changed payroll draft (#1144)';
  END IF;

  IF EXISTS (SELECT 1 FROM "PayrollRun") OR EXISTS (SELECT 1 FROM "PayrollPayout") THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unreviewed payroll run or payout obligations (#1144)';
  END IF;
  IF EXISTS (SELECT 1 FROM "Employee") AND (
    (SELECT count(*) FROM "Employee")<>2
    OR (SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) FROM "Employee" e)<>'7d7cfd679e5fec7380a15f0157a0488d'
    OR EXISTS (SELECT 1 FROM "Employee" WHERE md5("deploymentId"::text)<>'a64cbd2220d7dff53b89d23bd86f7a4c')
  ) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: reviewed historical roster changed (#1144)';
  END IF;

  IF EXISTS (SELECT 1 FROM "DeploymentWork" WHERE kind ILIKE '%payroll%')
    OR EXISTS (SELECT 1 FROM "ContractEvent" WHERE pg_temp.has_retired_payroll_input(payload) OR pg_temp.has_retired_payroll_input("decodedData"))
    OR EXISTS (SELECT 1 FROM "SignedTransaction" WHERE kind::text ILIKE '%payroll%')
    OR EXISTS (SELECT 1 FROM "TimelockRelease" WHERE "templateKind"::text IN ('PAYROLL','PAYROLL_DEV')) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unreviewed payroll work or financial evidence (#1144)';
  END IF;
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE action ILIKE '%payroll%' OR pg_temp.has_retired_payroll_input(metadata)) AND
    (SELECT md5(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text) FROM "AuditLog" a WHERE a.action ILIKE '%payroll%' OR pg_temp.has_retired_payroll_input(a.metadata))<>'6082bc1d7e7818fb7bc533df0e6d9d31' THEN
    RAISE EXCEPTION 'Payroll preservation blocked: reviewed payroll audit evidence changed (#1144)';
  END IF;

  IF EXISTS (SELECT 1 FROM "Deployment" WHERE md5(id::text)='a64cbd2220d7dff53b89d23bd86f7a4c') AND (
    (SELECT count(*) FROM "Employee")<>2
    OR (SELECT count(*) FROM "AuditLog" WHERE action ILIKE '%payroll%' OR pg_temp.has_retired_payroll_input(metadata))<>3
    OR (SELECT count(*) FROM "DeploymentWork" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c')<>3
    OR (SELECT count(*) FROM "ServiceTransaction" t JOIN "DeploymentWork" w ON w.id=t."workId" WHERE md5(w."deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c')<>3
    OR (SELECT count(*) FROM "SignedTransaction" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c')<>3
    OR EXISTS (SELECT 1 FROM "SignedTransaction" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND ("txHash",ledger) NOT IN (('4fd68238b05c37058240fe6c6c0b451424abff7cf65bd878dc0b2bc0e96bfd43',5452556),('90e2174156e4aa745bfaf1cf0e839602f7085505a80bc569ca652be26e6bbeab',5452582),('35909a8c91b5d16217deb187cde4963ea2535151e63ca4a2ff138bd8767f364d',5452695)))
    OR (SELECT count(DISTINCT t."txHash") FROM "ServiceTransaction" t JOIN "DeploymentWork" w ON w.id=t."workId" WHERE md5(w."deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c')<>3
    OR EXISTS (SELECT 1 FROM "ServiceTransaction" t JOIN "DeploymentWork" w ON w.id=t."workId" WHERE md5(w."deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND NOT EXISTS (SELECT 1 FROM "SignedTransaction" st WHERE st."deploymentId"=w."deploymentId" AND st."txHash"=t."txHash" AND st.ledger=t.ledger))
  ) THEN
    RAISE EXCEPTION 'Payroll preservation blocked: reviewed financial evidence set changed (#1144)';
  END IF;

  -- Recheck actual durable finality while writers are locked. Never clear
  -- null/unknown outcomes, pending intents, leases or obligations by age.
  IF EXISTS (SELECT 1 FROM "DeploymentWork" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND (state<>'DONE' OR "completedAt" IS NULL OR blocker IS NOT NULL))
    OR EXISTS (SELECT 1 FROM "ServiceTransaction" t JOIN "DeploymentWork" w ON w.id=t."workId" WHERE md5(w."deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND (t.state<>'SUCCESS' OR t.ledger IS NULL))
    OR EXISTS (SELECT 1 FROM "SignedTransaction" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND (outcome IS DISTINCT FROM 'CONFIRMED' OR ledger IS NULL))
    OR EXISTS (SELECT 1 FROM "WalletControlIntent" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c' AND state IN ('PREPARED','SUBMITTING'))
    OR EXISTS (SELECT 1 FROM "TimelockRelease" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c')
    OR EXISTS (SELECT 1 FROM "StreamerClaimJob" WHERE md5("deploymentId"::text)='a64cbd2220d7dff53b89d23bd86f7a4c') THEN
    RAISE EXCEPTION 'Payroll preservation blocked: unresolved original work or settlement obligations (#1144)';
  END IF;
END $$;
DROP FUNCTION pg_temp.has_retired_payroll_input(jsonb);
COMMIT;
