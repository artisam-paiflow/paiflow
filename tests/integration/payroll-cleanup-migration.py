#!/usr/bin/env python3
"""Real PostgreSQL payroll-preservation and both Prisma migration-history paths.

Uses only disposable databases CREATED by this process on a loopback PostgreSQL.
DATABASE_URL and PGPASSWORD are inherited; credentials are never printed. Fixture
identities and envelopes are synthetic. Fingerprint substitutions bind only the
reviewed synthetic fixture; production guards and all SQL statements stay intact.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit, urlunsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('--user', required=True)
args = parser.parse_args()
if not 1 <= args.port <= 65535 or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', args.user):
    parser.error('Invalid local port/user')
url = urlsplit(os.environ.get('DATABASE_URL', ''))
if url.hostname not in ('localhost', '127.0.0.1') or (url.port or 5432) != args.port:
    raise SystemExit('DATABASE_URL must select the same loopback test PostgreSQL')
repo = Path(__file__).resolve().parents[2]
retirement = '20261029150000_retire_payroll'
restoration = '20261030000000_preserve_payroll_history'
source = (repo / 'prisma/migrations' / retirement / 'migration.sql').read_text()
forward = (repo / 'prisma/migrations' / restoration / 'migration.sql').read_text()
original = (repo / 'tests/fixtures/migrations/payroll-retirement-original.sql').read_text()
original_checksum = hashlib.sha256(original.encode()).hexdigest()
if original_checksum != '241106af4be5cb6e787610ae8c2672c435a714fecb84b3dbd977227a4be1a949':
    raise SystemExit('Original retirement source changed; review history fixture')
psql = ['psql', '-h', '127.0.0.1', '-p', str(args.port), '-U', args.user, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']


def sql(db, text):
    return subprocess.run(psql + ['-d', db], input=text, text=True, capture_output=True, timeout=90)


def checked(db, text):
    result = sql(db, text)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


owner = '11111111-1111-4111-8111-111111111111'
flow = '22222222-2222-4222-8222-222222222222'
dep = '33333333-3333-4333-8333-333333333333'
graph = {'nodes': [{'id': 'payroll', 'type': 'payroll', 'config': {'asset': {'kind': 'native'}}}], 'edges': []}
base = f'''INSERT INTO "User" (id,username,"updatedAt") VALUES ('{owner}','synthetic-owner','2026-01-01');
INSERT INTO "Flow" (id,"ownerId",name,"templateKind",graph,parameters,"updatedAt") VALUES ('{flow}','{owner}','Synthetic historical payroll','PAYROLL',{literal(graph)},'{{}}','2026-01-01');
INSERT INTO "Deployment" (id,"flowId","ownerId",network,"graphSnapshot","paramsSnapshot","pipelineSnapshot",status,"sourceAccount","unsignedXdr","deployTxHash","idempotencyKey") VALUES ('{dep}','{flow}','{owner}','testnet',{literal(graph)},'[]','[{{"templateKind":"SUBSCRIPTION"}},{{"templateKind":"SPLITTER"}}]','CONFIRMED','synthetic-source','synthetic-unsigned','4fd68238b05c37058240fe6c6c0b451424abff7cf65bd878dc0b2bc0e96bfd43','synthetic-idempotency');
'''
for i, amount in [(1, '6000'), (2, '4000')]:
    base += f'''INSERT INTO "Employee" (id,"deploymentId",address,"amountStroops","updatedAt") VALUES ('00000000-0000-4000-8000-{i:012d}','{dep}','synthetic-wallet-{i}','{amount}','2026-01-01');\n'''
hashes = ['4fd68238b05c37058240fe6c6c0b451424abff7cf65bd878dc0b2bc0e96bfd43', '90e2174156e4aa745bfaf1cf0e839602f7085505a80bc569ca652be26e6bbeab', '35909a8c91b5d16217deb187cde4963ea2535151e63ca4a2ff138bd8767f364d']
for i, (tx_hash, ledger) in enumerate(zip(hashes, [5452556, 5452582, 5452695]), start=1):
    base += f'''INSERT INTO "AuditLog" (id,action,metadata,"createdAt") VALUES ('10000000-0000-4000-8000-{i:012d}','PAYROLL_SYNTHETIC','{{"kind":"payroll_trigger"}}','2026-01-01');
INSERT INTO "DeploymentWork" (id,"deploymentId",kind,state,"completedAt") VALUES ('20000000-0000-4000-8000-{i:012d}','{dep}','generic-submit','DONE','2026-01-01');
INSERT INTO "ServiceTransaction" (id,"workId","txHash",transport,state,ledger) VALUES ('30000000-0000-4000-8000-{i:012d}','20000000-0000-4000-8000-{i:012d}','{tx_hash}','rpc','SUCCESS',{ledger});
INSERT INTO "SignedTransaction" (id,"deploymentId","userId","txHash","signerAddress",kind,network,outcome,ledger) VALUES ('40000000-0000-4000-8000-{i:012d}','{dep}','{owner}','{tx_hash}','synthetic-source','INVOKE','testnet','CONFIRMED',{ledger});
'''
base += f'''INSERT INTO "ContractEvent" (id,"deploymentId","eventId",kind,ledger,"txHash",payload,"occurredAt") VALUES ('50000000-0000-4000-8000-000000000001','{dep}','synthetic-event','RECEIVE',5452556,'{hashes[0]}','{{"label":"payroll"}}','2026-01-01');
INSERT INTO "EventCursor" ("deploymentId","lastLedger","updatedAt") VALUES ('{dep}',5452556,'2026-01-01');
CREATE TEMP TABLE qa_bindings AS SELECT
 md5(f.id::text) fid, md5(d.id::text) did,
 md5(jsonb_build_object('id',f.id,'version',f.version,'templateKind',f."templateKind",'graph',f.graph,'parameters',f.parameters)::text) flow_hash,
 md5(jsonb_build_object('id',d.id,'flowId',d."flowId",'ownerId',d."ownerId",'network',d.network,'sourceAccount',d."sourceAccount",'deployTxHash',d."deployTxHash",'graphSnapshot',d."graphSnapshot",'paramsSnapshot',d."paramsSnapshot",'pipelineSnapshot',d."pipelineSnapshot")::text) deploy_hash,
 (SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) FROM "Employee" e) roster_hash,
 (SELECT md5(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text) FROM "AuditLog" a) audit_hash
 FROM "Flow" f JOIN "Deployment" d ON d."flowId"=f.id;
'''
bound = source
for original_hash, column in [('36d248bcfacfdd320b21c8446eb559e4', 'fid'), ('a64cbd2220d7dff53b89d23bd86f7a4c', 'did'), ('4c2f87d4d8eaacd22764cc19ffa0665b', 'flow_hash'), ('3d7b7420f18c84b43fd653f88ccc3ddd', 'deploy_hash'), ('7d7cfd679e5fec7380a15f0157a0488d', 'roster_hash'), ('6082bc1d7e7818fb7bc533df0e6d9d31', 'audit_hash')]:
    if "'" + original_hash + "'" not in bound:
        raise SystemExit('Production fingerprint binding drifted')
    bound = bound.replace("'" + original_hash + "'", '(SELECT ' + column + ' FROM qa_bindings)')
body = bound.replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0]
preserved = ['Flow', 'Deployment', 'Employee', 'PayrollRun', 'PayrollPayout', 'ContractTemplate', 'ContractEvent', 'SignedTransaction', 'DeploymentWork', 'ServiceTransaction', 'EventCursor', 'AuditLog', 'WalletControlIntent', 'TimelockRelease', 'StreamerClaimJob']
capture = ''.join(f'CREATE TEMP TABLE "qa_{t}" AS SELECT to_jsonb(x) value FROM "{t}" x;\n' for t in preserved)
compare = ''.join(f'''DO $$ BEGIN IF EXISTS (SELECT value FROM "qa_{t}" EXCEPT SELECT to_jsonb(x) FROM "{t}" x) OR EXISTS (SELECT to_jsonb(x) FROM "{t}" x EXCEPT SELECT value FROM "qa_{t}") THEN RAISE EXCEPTION '{t} changed'; END IF; END $$;\n''' for t in preserved)
cases = [('reviewed history remains byte-identical', '', None), ('ordinary payroll text label remains text', '''UPDATE "Flow" SET name='payroll labels are ordinary';''', None)]
for column in ['graph', 'parameters']:
    cases.append(('changed flow ' + column, f'''UPDATE "Flow" SET {column}='{{"changed":true}}';''', 'fixture identity'))
for column in ['graphSnapshot', 'paramsSnapshot', 'pipelineSnapshot']:
    cases.append(('changed deployment ' + column, f'''UPDATE "Deployment" SET "{column}"='{{"changed":true}}';''', 'fixture identity'))
for change in ['"templateKind"=\'SUBSCRIPTION\'', 'version=2']:
    cases.append(('changed flow ' + change, 'UPDATE "Flow" SET ' + change + ';', 'fixture identity'))
for change in ["status='FAILED'", '"serviceState"=\'RETIRING\',"retirementRequestedAt"=now()', '"chargeRelayerMode"=\'PLATFORM\'']:
    cases.append(('changed deployment ' + change, 'UPDATE "Deployment" SET ' + change + ';', 'fixture identity'))
for change in ['DELETE FROM "Employee";', 'UPDATE "Employee" SET "amountStroops"=\'1\';', 'DELETE FROM "AuditLog";', 'UPDATE "AuditLog" SET action=\'PAYROLL_TAMPERED\';']:
    cases.append(('changed roster/audit ' + change, change, 'Payroll preservation blocked'))
cases.append(('retired historical deployment still differs from reviewed intent', '''UPDATE "Deployment" SET "serviceState"='RETIRING',"retirementRequestedAt"=now(); UPDATE "Deployment" SET "serviceState"='RETIRED',"retiredAt"=now(),"retirementReconciledAt"=now();''', 'fixture identity'))
for status in ['DRAFT','BUILDING','PENDING_SIGNATURE','SUBMITTED']:
    cases.append(('nonterminal deployment ' + status, f"UPDATE \"Deployment\" SET status='{status}';", 'fixture identity'))
cases.append(('unreviewed second payroll deployment', f"""INSERT INTO "Deployment" (id,"flowId","ownerId",network,"graphSnapshot","paramsSnapshot",status) VALUES ('70000000-0000-4000-8000-000000000001','{flow}','{owner}','testnet','{{}}','{{}}','CONFIRMED');""", 'unreviewed payroll deployment'))
for table in ['DeploymentWork', 'ServiceTransaction', 'SignedTransaction']:
    # Do not delete referenced rows: erase one terminal marker or identity instead.
    if table == 'DeploymentWork': changes = ["state='OPEN'", "state='BLOCKED'", '"completedAt"=NULL', "blocker='unknown'"]
    elif table == 'ServiceTransaction': changes = ["state='PENDING'", 'ledger=NULL', 'ledger=1', f'''"txHash"='{hashes[0]}' ''']
    else: changes = ['outcome=NULL', "outcome='UNRESOLVED'", 'ledger=NULL', 'ledger=1']
    for change in changes:
        cases.append((table + ' ' + change, f'UPDATE "{table}" SET {change};', 'Payroll preservation blocked'))
cases += [('unreviewed draft', f'''INSERT INTO "Flow" (id,"ownerId",name,"templateKind",graph,parameters,"updatedAt") VALUES ('60000000-0000-4000-8000-000000000001','{owner}','other','PAYROLL','{{}}','{{}}',now());''', 'unreviewed'),
          ('unreviewed payout/run', f'''INSERT INTO "PayrollRun" (id,"deploymentId","runAt",status,"totalStroops","updatedAt") VALUES ('60000000-0000-4000-8000-000000000001','{dep}',now(),'FAILED','100',now());''', 'run or payout')]
for state in ['PREPARED', 'SUBMITTING']:
    cases.append(('unresolved intent ' + state, f'''INSERT INTO "WalletControlIntent" (id,"deploymentId",network,action,"txHash","nodeId","contractAddress","walletAddress","maxTime","preparationLedger",state) VALUES ('60000000-0000-4000-8000-000000000001','{dep}','testnet','CANCEL','synthetic-intent','payroll','synthetic-contract','synthetic-source','1800000000',42,'{state}');''', 'settlement obligations'))
cases += [('timelock lease/obligation', f'''INSERT INTO "TimelockRelease" (id,"deploymentId","nodeId","contractAddress","templateKind","leaseUntil","updatedAt") VALUES ('60000000-0000-4000-8000-000000000001','{dep}','lock','synthetic-contract','TIMELOCK',now()+interval '1 minute',now());''', 'settlement obligations'),
          ('streamer obligation', f'''INSERT INTO "StreamerClaimJob" (id,"deploymentId","nodeId","contractAddress","runAt",status,"updatedAt") VALUES ('60000000-0000-4000-8000-000000000001','{dep}','stream','synthetic-contract',now(),'RUNNING',now());''', 'settlement obligations')]

created = []
cache = repo / '.cache'
cache.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='payroll-preservation-', dir=cache) as directory:
    directory = Path(directory)
    config = directory / 'prisma.config.ts'
    config.write_text('export default { schema: "schema.prisma", migrations: { path: "migrations" } };\n')
    shutil.copy(repo / 'prisma/schema.prisma', directory / 'schema.prisma')
    migrations = directory / 'migrations'
    migrations.mkdir()
    for path in sorted((repo / 'prisma/migrations').iterdir()):
        if path.is_dir() and path.name < retirement:
            shutil.copytree(path, migrations / path.name)
        elif path.is_file():
            shutil.copy(path, migrations / path.name)

    def deploy(db):
        env = dict(os.environ, DATABASE_URL=urlunsplit(url._replace(path='/' + db)))
        result = subprocess.run([str(repo / 'node_modules/.bin/prisma'), 'migrate', 'deploy', '--config', str(config)], cwd=repo, env=env, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError('Prisma deploy failed: ' + result.stderr)

    try:
        for suffix in ['matrix', 'original', 'fresh', 'shadow']:
            db = f'qa_payroll_{os.getpid()}_{suffix}'
            checked('postgres', 'CREATE DATABASE "' + db + '";')
            created.append(db)
        matrix, applied, fresh, shadow = created
        deploy(matrix)
        for name, mutation, error in cases:
            result = sql(matrix, 'BEGIN;\n' + base + mutation + capture + body + compare + '\nROLLBACK;')
            good = result.returncode == 0 if error is None else result.returncode != 0 and error in result.stderr
            print(('PASS ' if good else 'FAIL ') + name, flush=True)
            if not good:
                raise RuntimeError(result.stderr)
        # The original source MUST really finish via Prisma before switching files.
        (migrations / retirement).mkdir()
        (migrations / retirement / 'migration.sql').write_text(original)
        deploy(applied)
        recorded = checked(applied, f'''SELECT checksum FROM "_prisma_migrations" WHERE migration_name='{retirement}' AND finished_at IS NOT NULL;''')
        if recorded != original_checksum:
            raise RuntimeError('Original source was not applied with its actual checksum')
        (migrations / retirement / 'migration.sql').write_text(source)
        shutil.copytree(repo / 'prisma/migrations' / restoration, migrations / restoration)
        deploy(applied)
        if checked(applied, f'''SELECT checksum FROM "_prisma_migrations" WHERE migration_name='{retirement}';''') != original_checksum:
            raise RuntimeError('Historical checksum was changed')
        for db in [applied, fresh]:
            deploy(db)
            checked(db, forward)  # repeated restoration is safe and preserves records
            required = checked(db, '''SELECT (to_regclass('"Employee"') IS NOT NULL AND to_regclass('"PayrollRun"') IS NOT NULL AND to_regclass('"PayrollPayout"') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='"TemplateKind"'::regtype AND enumlabel='PAYROLL'))::text;''')
            if required != 'true':
                raise RuntimeError('Historical schema not restored/preserved')
        # The two historical paths above deliberately stop at restoration. Bring
        # both forward through EVERY subsequent migration before comparing them
        # with today's schema. Omitting this phase made any later schema addition
        # look like a preservation failure despite a correct complete replay.
        subsequent = [path for path in sorted((repo / 'prisma/migrations').iterdir())
                      if path.is_dir() and path.name > restoration]
        for path in subsequent:
            shutil.copytree(path, migrations / path.name)
        for db in [applied, fresh]:
            deploy(db)
            applied_names = checked(db, '''SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;''').splitlines()
            expected_names = [path.name for path in sorted((repo / 'prisma/migrations').iterdir()) if path.is_dir()]
            if applied_names != expected_names:
                raise RuntimeError('Historical path did not apply the complete current migration chain')
        print(f'PASS both historical paths apply all {len(subsequent)} post-restoration migrations', flush=True)
        for db in [applied, fresh]:
            check = subprocess.run([str(repo / 'node_modules/.bin/prisma'), 'migrate', 'diff', '--from-url', urlunsplit(url._replace(path='/' + db)), '--to-schema-datamodel', str(repo / 'prisma/schema.prisma'), '--exit-code'], cwd=repo, env=os.environ, capture_output=True, text=True, timeout=120)
            if check.returncode:
                raise RuntimeError('Restored database schema drift: ' + check.stderr + check.stdout)
        for mutation in ["checksum='unknown'", "finished_at=NULL", "rolled_back_at=now()"]:
            result = sql(applied, "BEGIN; UPDATE \"_prisma_migrations\" SET " + mutation + " WHERE migration_name='" + retirement + "';\n" + forward.replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0] + "\nROLLBACK;")
            if result.returncode == 0 or 'unsupported, partial or unknown' not in result.stderr:
                raise RuntimeError('Migration-history guard did not refuse ' + mutation + ': ' + result.stderr)
        print('PASS both actual database schemas match ignored historical models and unknown/partial/checksum history is refused', flush=True)
        print('PASS original applied checksum -> corrected tree -> forward restore -> repeat deploy (no resolve/metadata rewrite)', flush=True)
        print('PASS fresh complete migration chain and idempotent forward restoration', flush=True)
        shadow_url = urlunsplit(url._replace(path='/' + shadow))
        replay = subprocess.run([str(repo / 'node_modules/.bin/prisma'), 'migrate', 'diff', '--from-migrations', str(repo / 'prisma/migrations'), '--to-schema-datamodel', str(repo / 'prisma/schema.prisma'), '--shadow-database-url', shadow_url, '--exit-code'], cwd=repo, env=os.environ, capture_output=True, text=True, timeout=120)
        if replay.returncode:
            raise RuntimeError('Prisma shadow replay/schema drift: ' + replay.stderr + replay.stdout)
        print('PASS real Prisma shadow replay and datamodel equivalence', flush=True)
        print(f'{len(cases)} PostgreSQL preservation cases passed', flush=True)
    finally:
        for db in reversed(created):
            checked('postgres', 'DROP DATABASE "' + db + '" WITH (FORCE);')
