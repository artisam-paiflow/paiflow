#!/usr/bin/env python3
"""Exercise #1141 against a dedicated local database at the pre-cleanup schema.

Requires Python 3 and psql. Supply --port, --database and --user explicitly;
psql inherits authentication (including PGPASSWORD) without this script reading
or printing credentials. Every fixture and the real migration run inside an
outer transaction that rolls back, including DDL. The preflight refuses a
nonempty application database and a schema that already lacks legacy tables.
"""
from pathlib import Path
import argparse
import json
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--database", required=True)
parser.add_argument("--user", required=True)
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    parser.error("--port must be between 1 and 65535")
for option, value in [("--database", args.database), ("--user", args.user)]:
    # Reject libpq connection strings/URIs, which could override the fixed host.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        parser.error(f"{option} must be a simple PostgreSQL identifier")

repo = Path(__file__).resolve().parents[2]
path = repo / "prisma/migrations/20261029090000_retire_offramp/migration.sql"
text = path.read_text()
if text.count("\nBEGIN;") != 1 or not text.rstrip().endswith("COMMIT;"):
    raise SystemExit("Unexpected migration transaction framing; review the harness")
migration = text.replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
command = ["psql", "-h", "127.0.0.1", "-p", str(args.port), "-U", args.user,
           "-d", args.database, "-X", "-q", "-v", "ON_ERROR_STOP=1"]

def run_sql(sql):
    try:
        return subprocess.run(command, input=sql, capture_output=True,
                              text=True, timeout=90)
    except FileNotFoundError:
        raise SystemExit("psql is required to run these local migration tests")
    except subprocess.TimeoutExpired:
        raise SystemExit("Local migration test exceeded its 90-second limit")

required = ["User", "Flow", "Deployment", "Employee", "ContractEvent", "AuditLog",
            "PayrollRun", "PayrollPayout", "DeploymentWork", "ServiceTransaction",
            "SignedTransaction", "EventCursor", "ContractTemplate", "TimelockRelease",
            "OffRampPayoutJob", "CashOutJobFailure", "OffRampSenderProfile",
            "EmployeeBankDetail", "OffRampProviderCredential"]
preflight = "BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; DO $$ BEGIN\n"
for table in required:
    preflight += (f'IF to_regclass(\'"{table}"\') IS NULL THEN '
                  f"RAISE EXCEPTION 'Missing legacy table {table}; use the pre-cleanup schema'; END IF;\n")
    preflight += (f'IF EXISTS (SELECT 1 FROM "{table}" LIMIT 1) THEN '
                  "RAISE EXCEPTION 'Refusing a nonempty application database; use a dedicated empty local test database'; END IF;\n")
preflight += "END $$; ROLLBACK;"
result = run_sql(preflight)
if result.returncode:
    print(result.stderr)
    raise SystemExit("Local baseline preflight failed; no fixtures were run")

base='''
INSERT INTO "User" (id,username,"updatedAt") VALUES ('11111111-1111-4111-8111-111111111111','fixture-owner',now());
INSERT INTO "Flow" (id,"ownerId",name,"templateKind",graph,parameters,"updatedAt",version) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Targeted fixture','PAYER','{}','{}','2026-09-01',7);
INSERT INTO "Deployment" (id,"flowId","ownerId",network,"graphSnapshot","paramsSnapshot",status,"sourceAccount","unsignedXdr","idempotencyKey") VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','testnet','{}','{}','PENDING_SIGNATURE','fixture-source','synthetic-unsigned-envelope','fixture-idempotency');
'''
event='''INSERT INTO "ContractEvent" (id,"deploymentId","eventId",kind,ledger,"txHash",payload,"occurredAt") VALUES ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','fixture-event','PAYOUT',42,'fixture-event-hash','{"amount":"10000000"}','2026-09-02');'''
employee='''INSERT INTO "Employee" (id,"deploymentId",address,"amountStroops","updatedAt") VALUES ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333','fixture-wallet','10000000',now());'''
def literal(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def graph(config=None, node_type='pay'):
    return {'nodes':[{'id':'receive','type':'on_receive','config':{'asset':{'kind':'native'}}},{'id':'pay','type':node_type,'config':config or {'recipient':'fixture-wallet','asset':{'kind':'native'},'fullAmount':True}}], 'edges':[{'id':'edge','source':'receive','target':'pay'}]}
def change_graph(value, target='Flow'):
    col='graph' if target=='Flow' else 'graphSnapshot'
    return f'UPDATE "{target}" SET "{col}"={literal(value)};'
cases=[('empty feature storage', '', None,'')]
for status in ['PENDING','RUNNING','QUOTED','INITIATED','COMPLETED','FAILED','CANCELLED']:
    cases.append((f'job row {status}',f'''INSERT INTO "OffRampPayoutJob" (id,"deploymentId","amountStroops","runAt","updatedAt",status,"completedAt") VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','100',now(),now(),'{status}',now());''','feature tables must be empty',''))
cases += [
('KYC table row', '''INSERT INTO "OffRampSenderProfile" (id,"deploymentId","firstName","lastName","countryOrigin","sourceOfFunds","updatedAt") VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','fixture','fixture','fixture','fixture',now());''','feature tables must be empty',''),
('provider credential row', '''INSERT INTO "OffRampProviderCredential" (id,provider,username,"accessToken","updatedAt") VALUES ('44444444-4444-4444-8444-444444444444','mock','synthetic','synthetic-no-access',now());''','feature tables must be empty',''),
('bank detail row',employee+'''INSERT INTO "EmployeeBankDetail" (id,"employeeId","accountName","accountNumber","bankCode","updatedAt") VALUES ('44444444-4444-4444-8444-444444444444','77777777-7777-4777-8777-777777777777','fixture','000','fixture',now());''','feature tables must be empty',''),
('dead letter row',event+'''INSERT INTO "CashOutJobFailure" (id,"deploymentId","contractEventId","sourceAddress","amountStroops","bankAccountName","bankAccountNumber","bankCode","updatedAt") VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','fixture','100','fixture','000','fixture',now());''','feature tables must be empty',''),
]
for instructions in [{'payoutMode':'fiat'},{'payoutMode':'FIAT'},{'isCashOut':True},{'is_cash_out':True},{'kind':'cash_out'},{'kind':'cash_out_dev'},{'templateKind':'CASH_OUT'},{'templateKind':'CASH_OUT_DEV'}]:
    for target,col in [('Flow','parameters'),('Deployment','paramsSnapshot'),('Deployment','pipelineSnapshot')]:
        cases.append((f'{target}.{col} retired {instructions}',f'UPDATE "{target}" SET "{col}"={literal([instructions])};','actual fiat/cash-out evidence',''))
for status in ['DRAFT','BUILDING','PENDING_SIGNATURE','SUBMITTED','CONFIRMED','FAILED']:
    cases.append((f'actual fiat regardless status {status}', f'''UPDATE "Deployment" SET status='{status}';'''+change_graph(graph({'recipient':'fixture-wallet','payoutMode':'fiat'}),'Deployment'),'actual fiat/cash-out evidence',''))
cases += [
('retired fiat still blocks', '''UPDATE "Deployment" SET "serviceState"='RETIRING',"retirementRequestedAt"=now(); UPDATE "Deployment" SET "serviceState"='RETIRED',"retiredAt"=now(),"retirementReconciledAt"=now();'''+change_graph(graph({'isCashOut':True}),'Deployment'),'actual fiat/cash-out evidence',''),
('enabled flag','UPDATE "Deployment" SET "offRampEnabled"=true;','actual fiat/cash-out evidence',''),
('FIAT employee',employee+'''UPDATE "Employee" SET "payoutMode"='FIAT';''','actual fiat/cash-out evidence',''),
('mapped sink employee',employee+'''UPDATE "Employee" SET "cashOutContractAddress"='fixture-contract';''','actual fiat/cash-out evidence',''),
('cash-out typed flow','''UPDATE "Flow" SET "templateKind"='CASH_OUT';''','actual fiat/cash-out evidence',''),
('cash-out typed event',event+'''UPDATE "ContractEvent" SET kind='CASH_OUT';''','actual fiat/cash-out evidence',''),
]
for field in ['accountName','accountNumber','bankCode']:
    for value in ['not-blank', None, 0, False, {}, []]:
        cases.append((f'nonblank/unexpected {field} {type(value).__name__}',change_graph(graph({'recipient':'fixture-wallet',field:value})),'nonempty or unexpected bank field',''))
for field in ['senderKyc','bankDetail']:
    cases.append((f'unexpected {field}',change_graph({**graph(),field:{}}),'outside supported empty Pay/Split fields',''))
for target,col in [('Flow','parameters'),('Deployment','paramsSnapshot'),('Deployment','pipelineSnapshot')]:
    cases.append((f'compiled metadata {target}.{col}',f'UPDATE "{target}" SET "{col}"={literal({"bankCode":""})};','unexpected bank/KYC metadata',''))
for config in [{'bankCode':''},{'label':'bankCode','accountName':''}]:
    cases.append(('blank metadata outside Pay/Split',change_graph({'nodes':[{'id':'condition','type':'condition','config':config}],'edges':[]}),'outside supported empty Pay/Split fields',''))
for kind in ['offramp-settlement','offramp-settlement:fixture','retirement-cash-out-recovery']:
    for state in ['OPEN','BLOCKED','DONE']:
        cases.append((f'provider work {kind} {state}',f'''INSERT INTO "DeploymentWork" (id,"deploymentId",kind,state) VALUES ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','{kind}','{state}');''','provider-specific durable work',''))
for target in ['Flow', 'Deployment']:
    for field in ['accountName', 'accountNumber', 'bankCode']:
        for value in ['', 'populated']:
            positioned = {**graph(), 'positions': {'point': {'x': 0, 'y': 0, field: value}}}
            cases.append((f'{target} coordinate {field} {value!r}', change_graph(positioned, target), 'retired metadata inside canvas coordinate values', ''))
    for metadata in [{'nested': {'senderKyc': {'firstName': 'Retired'}}},
                     {'nested': {'bankDetail': {}}}, {'nested': {'kind': 'cash_out'}},
                     {'nested': {'templateKind': 'CASH_OUT_DEV'}},
                     {'nested': {'isCashOut': True}}, {'nested': {'is_cash_out': True}},
                     {'nested': {'payoutMode': 'FIAT'}}]:
        positioned = {**graph(), 'positions': {'point': {'x': 0, 'y': 0, **metadata}}}
        cases.append((f'{target} nested coordinate metadata {metadata}', change_graph(positioned, target),
                      'actual fiat/cash-out evidence' if any(key in str(metadata) for key in ['cash_out', 'CASH_OUT', 'isCashOut', 'is_cash_out', 'payoutMode']) else 'retired metadata inside canvas coordinate values', ''))
    for positions in [None, [], 'coordinates', 0]:
        cases.append((f'{target} malformed positions {positions!r}', change_graph({**graph(), 'positions': positions}, target), 'malformed canvas positions', ''))
    for coordinate in [None, [], 0, 'coordinate', {'x': 0}, {'x': 0, 'y': '0'}]:
        cases.append((f'{target} malformed coordinate {coordinate!r}', change_graph({**graph(), 'positions': {'point': coordinate}}, target), 'malformed canvas coordinate value', ''))
clean_graph=graph({'recipient':'fixture-wallet','asset':{'kind':'native'},'fullAmount':True,'accountName':'','accountNumber':'   ','bankCode':''})
clean_graph['positions']={'bankCode':{'x':12,'y':34},'accountName':{'x':56,'y':78},'accountNumber':{'x':90,'y':12},'senderKyc':{'x':34,'y':56}}
setup=change_graph(clean_graph)+change_graph(clean_graph,'Deployment')+event+employee+'''
INSERT INTO "SignedTransaction" (id,"deploymentId","userId","txHash","signerAddress",kind,network,outcome) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','fixture-signed-hash','fixture-signer','DEPLOY','testnet','UNRESOLVED');
INSERT INTO "DeploymentWork" (id,"deploymentId",kind,state) VALUES ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','generic-submit','BLOCKED');
INSERT INTO "ServiceTransaction" (id,"workId","txHash",transport) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','66666666-6666-4666-8666-666666666666','fixture-pending-service-hash','rpc');
INSERT INTO "EventCursor" ("deploymentId","lastLedger","updatedAt") VALUES ('33333333-3333-4333-8333-333333333333',42,now());
INSERT INTO "PayrollRun" (id,"deploymentId","runAt",status,"totalStroops","updatedAt") VALUES ('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333',now(),'CHARGED','10000000',now());
INSERT INTO "PayrollPayout" (id,"payrollRunId","employeeId","amountStroops","txHash") VALUES ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777','10000000','fixture-payout-hash');
INSERT INTO "ContractTemplate" (id,kind,"wasmHash",network,"abiJson") VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','CASH_OUT','synthetic','testnet','{}');
CREATE TEMP TABLE expected_unchanged AS SELECT 'Deployment' AS kind,to_jsonb(d)-'graphSnapshot'-'offRampEnabled' AS value FROM "Deployment" d UNION ALL SELECT 'ContractEvent',to_jsonb(e) FROM "ContractEvent" e UNION ALL SELECT 'SignedTransaction',to_jsonb(t) FROM "SignedTransaction" t UNION ALL SELECT 'DeploymentWork',to_jsonb(w) FROM "DeploymentWork" w UNION ALL SELECT 'ServiceTransaction',to_jsonb(t) FROM "ServiceTransaction" t UNION ALL SELECT 'EventCursor',to_jsonb(c) FROM "EventCursor" c UNION ALL SELECT 'PayrollRun',to_jsonb(r) FROM "PayrollRun" r UNION ALL SELECT 'PayrollPayout',to_jsonb(p) FROM "PayrollPayout" p UNION ALL SELECT 'Employee',to_jsonb(e)-'payoutMode'-'cashOutContractAddress' FROM "Employee" e;
CREATE TEMP TABLE expected_graph AS SELECT graph AS value FROM "Flow";
'''
checks='''
DO $$
DECLARE rows_count integer;
BEGIN
 IF EXISTS (SELECT value FROM expected_unchanged WHERE kind='Deployment' EXCEPT SELECT to_jsonb(d)-'graphSnapshot' FROM "Deployment" d) OR EXISTS (SELECT to_jsonb(d)-'graphSnapshot' FROM "Deployment" d EXCEPT SELECT value FROM expected_unchanged WHERE kind='Deployment') THEN RAISE EXCEPTION 'Deployment financial/finality bytes changed'; END IF;
 IF (SELECT version FROM "Flow") <> 8 THEN RAISE EXCEPTION 'Flow version did not advance exactly once'; END IF;
 IF (SELECT "unsignedXdr" FROM "Deployment") <> 'synthetic-unsigned-envelope' OR (SELECT "idempotencyKey" FROM "Deployment") <> 'fixture-idempotency' THEN RAISE EXCEPTION 'Envelope/idempotency lost'; END IF;
 IF (SELECT outcome::text FROM "SignedTransaction") <> 'UNRESOLVED' OR (SELECT state::text FROM "ServiceTransaction") <> 'PENDING' OR (SELECT state::text FROM "DeploymentWork") <> 'BLOCKED' THEN RAISE EXCEPTION 'Unknown outcome/admission was cleared'; END IF;
 IF (SELECT count(*) FROM "Flow")<>1 OR (SELECT count(*) FROM "Deployment")<>1 OR (SELECT count(*) FROM "ContractEvent")<>1 OR (SELECT count(*) FROM "Employee")<>1 OR (SELECT count(*) FROM "PayrollPayout")<>1 THEN RAISE EXCEPTION 'Shared crypto history removed'; END IF;
 IF (SELECT count(*) FROM "AuditLog" WHERE action='OFFRAMP_EMPTY_METADATA_REMOVED')<>2 THEN RAISE EXCEPTION 'Blank metadata changes not audited individually'; END IF;
 IF EXISTS (SELECT 1 FROM "ContractTemplate" WHERE kind::text LIKE 'CASH_OUT%') THEN RAISE EXCEPTION 'Retired template remains'; END IF;
 IF to_regclass('"OffRampPayoutJob"') IS NOT NULL OR to_regtype('"OffRampPayoutJobStatus"') IS NOT NULL OR to_regtype('"EmployeePayoutMode"') IS NOT NULL THEN RAISE EXCEPTION 'Obsolete feature storage remains'; END IF;
 IF (SELECT "graphSnapshot"->'positions' FROM "Deployment") IS DISTINCT FROM (SELECT value->'positions' FROM expected_graph) THEN RAISE EXCEPTION 'Arbitrary UI node IDs changed'; END IF;
 IF EXISTS (SELECT 1 FROM "Deployment" WHERE "graphSnapshot"#>'{nodes,1,config}' ?| ARRAY['accountName','accountNumber','bankCode']) OR EXISTS(SELECT 1 FROM "Flow" WHERE graph#>'{nodes,1,config}' ?| ARRAY['accountName','accountNumber','bankCode']) THEN RAISE EXCEPTION 'Blank bank fields not removed'; END IF;
END $$;
'''
for table in ['ContractEvent','SignedTransaction','DeploymentWork','ServiceTransaction','EventCursor','PayrollRun','PayrollPayout']:
    checks+=f'''DO $$ BEGIN IF EXISTS (SELECT value FROM expected_unchanged WHERE kind='{table}' EXCEPT SELECT to_jsonb(t) FROM "{table}" t) OR EXISTS (SELECT to_jsonb(t) FROM "{table}" t EXCEPT SELECT value FROM expected_unchanged WHERE kind='{table}') THEN RAISE EXCEPTION '{table} evidence changed'; END IF; END $$;\n'''

expected_clean_graph = graph({'recipient':'fixture-wallet','asset':{'kind':'native'},'fullAmount':True})
expected_clean_graph['positions'] = clean_graph['positions']
setup += '''
CREATE TEMP TABLE expected_flow_fields AS SELECT to_jsonb(f)-'graph'-'version'-'updatedAt' AS value FROM "Flow" f;
'''
checks += f'''
DO $$ BEGIN
 IF (SELECT graph FROM "Flow") IS DISTINCT FROM {literal(expected_clean_graph)}
   OR (SELECT "graphSnapshot" FROM "Deployment") IS DISTINCT FROM {literal(expected_clean_graph)}
 THEN RAISE EXCEPTION 'Graph fields beyond the approved blank bank keys changed'; END IF;
 IF (SELECT to_jsonb(f)-'graph'-'version'-'updatedAt' FROM "Flow" f)
   IS DISTINCT FROM (SELECT value FROM expected_flow_fields)
 THEN RAISE EXCEPTION 'Unrelated current Flow fields changed'; END IF;
 IF (SELECT to_jsonb(e) FROM "Employee" e)
   IS DISTINCT FROM (SELECT value FROM expected_unchanged WHERE kind='Employee')
 THEN RAISE EXCEPTION 'Crypto employee amounts, addresses or labels changed'; END IF;
END $$;
'''

cases.append(('blank metadata cleanup preserves crypto/finality evidence',setup,None,checks))

# Fixed-recipient amounts remain strings and preserve their exact order/precision.
split = {'nodes': [
    {'id': 'receive', 'type': 'on_receive', 'config': {'asset': {'kind': 'native'}}},
    {'id': 'bankCode', 'type': 'split', 'config': {'asset': {'kind': 'native'}, 'recipients': [
        {'address': 'fixture-first', 'mode': 'fixed', 'amountStroops': '9007199254740993',
         'label': 'First', 'payoutMode': 'crypto', 'accountName': '', 'accountNumber': '  ', 'bankCode': ''},
        {'address': 'fixture-second', 'mode': 'fixed', 'amountStroops': '10000000',
         'label': 'Second', 'accountName': '', 'accountNumber': '', 'bankCode': ''},
    ]}},
], 'edges': [{'id': 'edge', 'source': 'receive', 'target': 'bankCode'}],
    'positions': {'bankCode': {'x': 12, 'y': 34}}}
expected_split = json.loads(json.dumps(split))
for recipient in expected_split['nodes'][1]['config']['recipients']:
    for field in ['accountName', 'accountNumber', 'bankCode']:
        del recipient[field]
split_setup = change_graph(split) + change_graph(split, 'Deployment')
split_checks = f'''
DO $$ BEGIN
 IF (SELECT graph FROM "Flow") IS DISTINCT FROM {literal(expected_split)}
   OR (SELECT "graphSnapshot" FROM "Deployment") IS DISTINCT FROM {literal(expected_split)}
 THEN RAISE EXCEPTION 'Split recipient order, money, address, label or layout changed'; END IF;
 IF (SELECT version FROM "Flow") <> 8 THEN RAISE EXCEPTION 'Split cleanup version changed incorrectly'; END IF;
 IF (SELECT count(*) FROM "AuditLog" WHERE action='OFFRAMP_EMPTY_METADATA_REMOVED') <> 2
 THEN RAISE EXCEPTION 'Split cleanup did not audit both changes'; END IF;
END $$;
'''
cases.append(('split blank cleanup preserves recipient order and exact money', split_setup, None, split_checks))

# Graphs with no obsolete keys must not receive version or audit noise.
unchanged_graph = graph()
unchanged_graph['positions'] = {'accountName': {'x': 0, 'y': 100}}
no_op_setup = change_graph(unchanged_graph) + change_graph(unchanged_graph, 'Deployment') + '''
INSERT INTO "AuditLog" (id,"userId",action,metadata,"createdAt") VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','FIXTURE_UNCHANGED','{"purpose":"preserve existing audit"}','2026-09-01');
CREATE TEMP TABLE expected_flow AS SELECT to_jsonb(f) AS value FROM "Flow" f;
CREATE TEMP TABLE expected_deployment AS SELECT to_jsonb(d)-'offRampEnabled' AS value FROM "Deployment" d;
CREATE TEMP TABLE expected_audit AS SELECT to_jsonb(a) AS value FROM "AuditLog" a;
'''
no_op_checks = '''
DO $$ BEGIN
 IF (SELECT to_jsonb(f) FROM "Flow" f) IS DISTINCT FROM (SELECT value FROM expected_flow)
 THEN RAISE EXCEPTION 'No-op Flow graph/version/timestamps or other fields changed'; END IF;
 IF (SELECT to_jsonb(d) FROM "Deployment" d) IS DISTINCT FROM (SELECT value FROM expected_deployment)
 THEN RAISE EXCEPTION 'No-op deployment graph or financial bytes changed'; END IF;
 IF EXISTS (SELECT value FROM expected_audit EXCEPT SELECT to_jsonb(a) FROM "AuditLog" a)
   OR EXISTS (SELECT to_jsonb(a) FROM "AuditLog" a EXCEPT SELECT value FROM expected_audit)
 THEN RAISE EXCEPTION 'No-op graph introduced or changed audit records'; END IF;
END $$;
'''
cases.append(('clean graphs preserve every field version timestamp and existing audit', no_op_setup, None, no_op_checks))

for name, fixture, expected, verify in cases:
    result=run_sql('BEGIN;\n'+base+fixture+'\n'+migration+'\n'+verify+'\nROLLBACK;\n')
    good=(result.returncode==0) if expected is None else (result.returncode!=0 and expected in result.stderr)
    print(('PASS' if good else 'FAIL')+' '+name,flush=True)
    if not good:print(result.stderr);raise SystemExit(1)
print(f'{len(cases)} targeted migration cases passed; all fixtures rolled back')

result = run_sql(preflight)
if result.returncode:
    print(result.stderr)
    raise SystemExit("Postflight failed: a fixture or schema change escaped rollback")
print("PASS baseline schema and empty application data restored after every rollback")
