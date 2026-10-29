#!/usr/bin/env python3
"""Test #1144 only against an empty disposable loopback pre-retirement database.

Requires psql. Authentication is inherited by psql, never read or printed here.
Every fixture and migration executes in an outer transaction that rolls back.
The authorized-draft cases replace only the three equality fingerprints with
synthetic fixture fingerprints; actual migration guards and statements remain.
No live identifiers, user configurations or credentials are fixture material.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--database', required=True)
parser.add_argument('--user', required=True)
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    parser.error('--port must be between 1 and 65535')
for option, value in [('--database', args.database), ('--user', args.user)]:
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', value):
        parser.error(f'{option} must be a simple PostgreSQL identifier')

repo = Path(__file__).resolve().parents[2]
source = (repo / 'prisma/migrations/20261029150000_retire_payroll/migration.sql').read_text()
if source.count('\nBEGIN;') != 1 or not source.rstrip().endswith('COMMIT;'):
    raise SystemExit('Unexpected migration transaction framing; review harness')
migration = source.replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0]
command = ['psql', '-h', '127.0.0.1', '-p', str(args.port), '-U', args.user,
           '-d', args.database, '-X', '-q', '-v', 'ON_ERROR_STOP=1']


def run_sql(sql):
    try:
        return subprocess.run(command, input=sql, capture_output=True,
                              text=True, timeout=90)
    except FileNotFoundError:
        raise SystemExit('psql is required')
    except subprocess.TimeoutExpired:
        raise SystemExit('Local migration case exceeded its 90-second limit')


required = ['User', 'Flow', 'Deployment', 'Employee', 'PayrollRun', 'PayrollPayout',
            'ContractTemplate', 'TimelockRelease', 'ContractEvent', 'AuditLog',
            'SignedTransaction', 'DeploymentWork', 'ServiceTransaction', 'EventCursor']
preflight = "BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; DO $$ BEGIN\n"
for table in required:
    preflight += (f'IF to_regclass(\'"{table}"\') IS NULL THEN '
                  f"RAISE EXCEPTION 'Missing {table}; use pre-payroll-retirement schema'; END IF;\n")
    preflight += (f'IF EXISTS (SELECT 1 FROM "{table}" LIMIT 1) THEN '
                  "RAISE EXCEPTION 'Refusing nonempty database; use a dedicated empty local test database'; END IF;\n")
preflight += 'END $$; ROLLBACK;'
result = run_sql(preflight)
if result.returncode:
    print(result.stderr)
    raise SystemExit('Preflight failed; no fixtures run')


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


owner = '11111111-1111-4111-8111-111111111111'
flow = '22222222-2222-4222-8222-222222222222'
deployment = '33333333-3333-4333-8333-333333333333'
authorized = '44444444-4444-4444-8444-444444444444'
synthetic_graph = {'nodes': [{'id': 'fixture-split', 'type': 'split', 'config': {}},
                             {'id': 'fixture-payroll', 'type': 'payroll', 'config': {}}],
                   'edges': []}
synthetic_parameters = {'fixture': 'authorized-undeployed'}
bound_migration = migration.replace("'4f8cbf87d1790d1afb8c8032b40155c7'",
                                    "'" + hashlib.md5(authorized.encode()).hexdigest() + "'")
bound_migration = bound_migration.replace("'38b4a4b922dff127111e6efc2b70d93a'",
                                         'md5(' + literal(synthetic_graph) + '::text)')
bound_migration = bound_migration.replace("'5c2731fcdc9c09af07edf7aeab6e5f91'",
                                         'md5(' + literal(synthetic_parameters) + '::text)')
if bound_migration == migration or any(x in bound_migration for x in [
        '4f8cbf87d1790d1afb8c8032b40155c7', '38b4a4b922dff127111e6efc2b70d93a',
        '5c2731fcdc9c09af07edf7aeab6e5f91']):
    raise SystemExit('Fingerprint fixture binding drifted; review harness')
base = f'''
INSERT INTO "User" (id,username,"updatedAt") VALUES ('{owner}','fixture-owner',now());
INSERT INTO "Flow" (id,"ownerId",name,"templateKind",graph,parameters,"updatedAt") VALUES ('{flow}','{owner}','Ordinary flow','PAYER','{{}}','{{}}',now());
INSERT INTO "Deployment" (id,"flowId","ownerId",network,"graphSnapshot","paramsSnapshot",status,"sourceAccount","unsignedXdr","idempotencyKey") VALUES ('{deployment}','{flow}','{owner}','testnet','{{}}','{{}}','PENDING_SIGNATURE','fixture-source','synthetic-unsigned-envelope','fixture-idempotency');
'''
authorized_fixture = f'''
INSERT INTO "Flow" (id,"ownerId",name,"templateKind",graph,parameters,"updatedAt",version) VALUES ('{authorized}','{owner}','Synthetic authorized draft','SPLITTER',{literal(synthetic_graph)},{literal(synthetic_parameters)},now(),12);
INSERT INTO "AuditLog" (id,action,metadata) VALUES ('55555555-5555-4555-8555-555555555555','FLOW_UPDATE',jsonb_build_object('flowId','{authorized}','version',12));
CREATE TEMP TABLE expected_audit AS SELECT to_jsonb(a) value FROM "AuditLog" a;
'''
empty_checks = '''
DO $$ BEGIN
 IF to_regclass('"Employee"') IS NOT NULL OR to_regclass('"PayrollRun"') IS NOT NULL
  OR to_regclass('"PayrollPayout"') IS NOT NULL OR to_regtype('"PayrollRunStatus"') IS NOT NULL
 THEN RAISE EXCEPTION 'Retired payroll storage remains'; END IF;
 IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='"TemplateKind"'::regtype AND enumlabel='PAYROLL')
 THEN RAISE EXCEPTION 'PAYROLL enum remains'; END IF;
 IF EXISTS (SELECT 1 FROM "ContractTemplate" WHERE kind::text='PAYROLL')
 THEN RAISE EXCEPTION 'Payroll template remains'; END IF;
END $$;
'''
authorized_checks = f'''
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Flow" WHERE id='{authorized}') THEN RAISE EXCEPTION 'Authorized draft remains'; END IF;
 IF (SELECT count(*) FROM "Flow")<>1 OR (SELECT count(*) FROM "Deployment")<>1 THEN RAISE EXCEPTION 'Ordinary data lost'; END IF;
 IF EXISTS (SELECT value FROM expected_audit EXCEPT SELECT to_jsonb(a) FROM "AuditLog" a) THEN RAISE EXCEPTION 'Original audit evidence lost'; END IF;
 IF (SELECT count(*) FROM "AuditLog" WHERE action='PAYROLL_UNDEPLOYED_DRAFT_REMOVED' AND metadata->>'flowId'='{authorized}')<>1 THEN RAISE EXCEPTION 'Deletion missing audit'; END IF;
END $$;
'''
# name, fixture, error substring (None means success), assertions, synthetic binding
cases = [('empty payroll storage', '', None, empty_checks, False),
         ('unused payroll template', '''INSERT INTO "ContractTemplate" (id,kind,"wasmHash",network,"abiJson") VALUES ('66666666-6666-4666-8666-666666666666','PAYROLL','synthetic','testnet','{}');''', None, empty_checks, False),
         ('authorized exact undeployed draft', authorized_fixture, None, empty_checks + authorized_checks, True),
         ('real migration refuses synthetic identity', authorized_fixture, 'unexpected payroll flow', '', False)]
for change in ["version=13", "\"templateKind\"='PAYER'", "graph=graph||'{\"changed\":true}'::jsonb", "parameters='{}'"]:
    cases.append(('changed authorized draft ' + change,
                  authorized_fixture + f'UPDATE "Flow" SET {change} WHERE id=\'{authorized}\';',
                  'authorized draft changed', '', True))
for field in ['graph', 'parameters']:
    for marker in [{'type': 'payroll'}, {'kind': 'payroll_trigger'}, {'kind': 'payroll_trigger_dev'}, {'templateKind': 'PAYROLL'},
                   {'type': 'payroll_dev'}, {'templateKind': 'PAYROLL_DEV'}]:
        cases.append((f'unexpected flow {field} {marker}',
                      f'UPDATE "Flow" SET {field}={literal({"nested": [marker]})};' +
                      f'DELETE FROM "Deployment" WHERE id=\'{deployment}\';',
                      'unexpected payroll flow', '', False))
for col in ['graphSnapshot', 'paramsSnapshot', 'pipelineSnapshot']:
    for marker in [{'type': 'payroll'}, {'kind': 'payroll_trigger'}, {'kind': 'payroll_trigger_dev'}, {'templateKind': 'PAYROLL'}, {'templateKind': 'PAYROLL_DEV'}]:
        cases.append((f'deployment {col} {marker}',
                      f'UPDATE "Deployment" SET "{col}"={literal({"nested": [marker]})};',
                      'payroll deployment', '', False))
for status in ['DRAFT', 'BUILDING', 'PENDING_SIGNATURE', 'SUBMITTED', 'CONFIRMED', 'FAILED']:
    cases.append((f'current subscription payroll status {status}',
                  f'''UPDATE "Deployment" SET status='{status}', "graphSnapshot"={literal(synthetic_graph)}, "pipelineSnapshot"='[{{"templateKind":"SUBSCRIPTION"}},{{"templateKind":"SPLITTER"}}]';''',
                  'payroll deployment', '', False))
    cases.append((f'authorized draft acquired deployment {status}',
                  authorized_fixture + f'''UPDATE "Deployment" SET "flowId"='{authorized}',status='{status}';''',
                  'payroll deployment', '', True))
cases.append(('retired payroll still blocks', '''UPDATE "Deployment" SET "serviceState"='RETIRING',"retirementRequestedAt"=now(); UPDATE "Deployment" SET "serviceState"='RETIRED',"retiredAt"=now(),"retirementReconciledAt"=now(); UPDATE "Flow" SET "templateKind"='PAYROLL';''', 'payroll deployment', '', False))
employee = f'''INSERT INTO "Employee" (id,"deploymentId",address,"amountStroops","updatedAt") VALUES ('77777777-7777-4777-8777-777777777777','{deployment}','fixture-wallet','100',now());'''
run = f'''INSERT INTO "PayrollRun" (id,"deploymentId","runAt",status,"totalStroops","updatedAt") VALUES ('88888888-8888-4888-8888-888888888888','{deployment}',now(),'FAILED','100',now());'''
cases += [('employee row', employee, 'storage must be empty', '', False),
          ('failed payroll run', run, 'storage must be empty', '', False),
          ('payout record', employee + run + '''INSERT INTO "PayrollPayout" (id,"payrollRunId","employeeId","amountStroops","txHash") VALUES ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777','100','fixture-payout');''', 'storage must be empty', '', False)]
for state in ['OPEN', 'BLOCKED', 'DONE']:
    for kind in ['auto-charge-payroll', '/api/deployments/fixture/payroll-charge', 'dev-payroll-deploy']:
        cases.append((f'payroll work {kind} {state}', f'''INSERT INTO "DeploymentWork" (id,"deploymentId",kind,state) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{deployment}','{kind}','{state}');''', 'payroll work or retained evidence', '', False))
cases += [
    ('payroll event', f'''INSERT INTO "ContractEvent" (id,"deploymentId","eventId",kind,ledger,"txHash",payload,"occurredAt") VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{deployment}','fixture-event','PAYOUT',42,'fixture-event-hash','{{"templateKind":"PAYROLL"}}',now());''', 'payroll work or retained evidence', '', False),
    ('payroll audit action', '''INSERT INTO "AuditLog" (id,action,metadata) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','PAYROLL_CHARGE','{}');''', 'payroll work or retained evidence', '', False),
    ('payroll structured audit metadata', '''INSERT INTO "AuditLog" (id,action,metadata) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DEPLOY_INVOKE','{"kind":"payroll_trigger"}');''', 'payroll work or retained evidence', '', False),
]
# Prove ordinary payroll labels and unresolved financial evidence survive byte-for-byte.
retained = f'''
UPDATE "Flow" SET name='payroll label is ordinary text',graph='{{"nodes":[{{"type":"split","config":{{"label":"payroll"}}}}]}}';
UPDATE "Deployment" SET "graphSnapshot"=(SELECT graph FROM "Flow");
INSERT INTO "SignedTransaction" (id,"deploymentId","userId","txHash","signerAddress",kind,network,outcome) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{deployment}','{owner}','fixture-signed-hash','fixture-signer','DEPLOY','testnet','UNRESOLVED');
INSERT INTO "DeploymentWork" (id,"deploymentId",kind,state) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{deployment}','generic-submit','BLOCKED');
INSERT INTO "ServiceTransaction" (id,"workId","txHash",transport) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fixture-pending-hash','rpc');
INSERT INTO "ContractEvent" (id,"deploymentId","eventId",kind,ledger,"txHash",payload,"occurredAt") VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','{deployment}','fixture-event','PAYOUT',42,'fixture-event-hash','{{"label":"payroll"}}',now());
INSERT INTO "EventCursor" ("deploymentId","lastLedger","updatedAt") VALUES ('{deployment}',42,now());
INSERT INTO "AuditLog" (id,action,metadata) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','FLOW_UPDATE','{{"label":"payroll"}}');
'''
for table in ['Flow', 'Deployment', 'ContractEvent', 'SignedTransaction', 'DeploymentWork', 'ServiceTransaction', 'EventCursor', 'AuditLog']:
    retained += f'CREATE TEMP TABLE "expected_{table}" AS SELECT to_jsonb(t) value FROM "{table}" t;\n'
retained_checks = ''
for table in ['Flow', 'Deployment', 'ContractEvent', 'SignedTransaction', 'DeploymentWork', 'ServiceTransaction', 'EventCursor', 'AuditLog']:
    retained_checks += f'''DO $$ BEGIN IF EXISTS (SELECT value FROM "expected_{table}" EXCEPT SELECT to_jsonb(t) FROM "{table}" t) OR EXISTS (SELECT to_jsonb(t) FROM "{table}" t EXCEPT SELECT value FROM "expected_{table}") THEN RAISE EXCEPTION '{table} evidence changed'; END IF; END $$;\n'''
cases.append(('preserve ordinary labels and unknown financial evidence', retained, None, empty_checks + retained_checks, False))

for name, fixture, expected, checks, bound in cases:
    result = run_sql('BEGIN;\n' + base + fixture + '\n' + (bound_migration if bound else migration) + '\n' + checks + '\nROLLBACK;\n')
    good = result.returncode == 0 if expected is None else result.returncode != 0 and expected in result.stderr
    print(('PASS ' if good else 'FAIL ') + name, flush=True)
    if not good:
        print(result.stderr)
        raise SystemExit(1)
result = run_sql(preflight)
if result.returncode:
    print(result.stderr)
    raise SystemExit('Postflight failed; baseline data/schema escaped rollback')
print(f'{len(cases)} payroll migration cases passed; all fixtures and DDL rolled back')
