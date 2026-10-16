"""Opt-in local verification with task-owned scratch PostgreSQL and Redis.

Requires Python 3, Docker, Node/pnpm and Playwright Chromium. Creates a fresh
fixture database; never resets an existing database or flushes Redis.
"""
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import signal
import socket
import subprocess
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONSUMER = pathlib.Path('/tmp/paiflow-dev-token-verify')


def inspect_container(name, internal_port, host_port):
    info = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
    expected = [{'HostIp': '127.0.0.1', 'HostPort': str(host_port)}]
    if not info['State']['Running'] or info['NetworkSettings']['Ports'].get(f'{internal_port}/tcp') != expected:
        raise RuntimeError(f'{name} must be running with its expected loopback-only port')
    return info


# Fail before creating fixtures if a different app already occupies the target port.
for family, address in [(socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')]:
    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.bind((address, 3384))

postgres = inspect_container('paiflow-dev-token-scratch', 5432, 55439)
inspect_container('paiflow-dev-token-redis-scratch', 6379, 6379)
config = dict(item.split('=', 1) for item in postgres['Config']['Env'] if '=' in item)
name = 'dev_token_verify_' + secrets.token_hex(6)
subprocess.run([
    'docker', 'exec', 'paiflow-dev-token-scratch', 'createdb', '-U',
    config.get('POSTGRES_USER', 'postgres'), name,
], check=True)
url = ('postgresql://' + urllib.parse.quote(config.get('POSTGRES_USER', 'postgres'), safe='')
       + ':' + urllib.parse.quote(config['POSTGRES_PASSWORD'], safe='')
       + '@127.0.0.1:55439/' + name)
# Explicit overrides also prevent .env.local from enabling network transactions or analytics.
child_env = {key: os.environ[key] for key in ['PATH', 'HOME', 'USER', 'SHELL'] if key in os.environ}
child_env.update(
    DATABASE_URL=url, REDIS_URL='redis://127.0.0.1:6379/13',
    AUTH_SECRET=secrets.token_hex(32), AUTH_URL='http://localhost:3384', AUTH_TRUST_HOST='true',
    STELLAR_NETWORK='testnet', STELLAR_SOROBAN_RPC_URL_TESTNET='https://127.0.0.1:9',
    STELLAR_HORIZON_URL_TESTNET='https://127.0.0.1:9', STELLAR_RELAYER_SECRET_KEY='',
    NEXT_PUBLIC_POSTHOG_KEY='', POSTHOG_PERSONAL_API_KEY='',
    NEXT_PUBLIC_APP_URL='http://localhost:3384', NEXT_PUBLIC_APP_ENV='local',
    RAILWAY_ENVIRONMENT_NAME='local-verification', LOG_LEVEL='info',
    NEXT_TELEMETRY_DISABLED='1', PLAYWRIGHT_NO_COPY_PROMPT='1',
)


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, env=child_env, check=True, **kwargs)


run(['pnpm', 'exec', 'prisma', 'migrate', 'deploy'], stdout=subprocess.DEVNULL)
run(['pnpm', 'sdk:build'])
if CONSUMER.is_symlink():
    raise RuntimeError('Refusing a symlink at the task-owned SDK scratch directory')
CONSUMER.mkdir(exist_ok=True)
# Reinstall from the freshly emitted tarball, even when package version is unchanged.
shutil.rmtree(CONSUMER / 'node_modules', ignore_errors=True)
(CONSUMER / 'package-lock.json').unlink(missing_ok=True)
run(['npm', 'pack', './packages/sdk', '--ignore-scripts', '--pack-destination', str(CONSUMER)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
artifact = CONSUMER / 'paiflow-sdk-0.1.0.tgz'
(CONSUMER / 'package.json').write_text('{"private":true,"type":"module"}')
run(['npm', 'install', '--prefix', str(CONSUMER), '--ignore-scripts', '--no-audit', '--no-fund', str(artifact)],
    stdout=subprocess.DEVNULL)
with open(CONSUMER / 'app.log', 'w') as log:
    os.chmod(CONSUMER / 'app.log', 0o600)
    server = subprocess.Popen([
        'pnpm', 'exec', 'next', 'dev', '--hostname', 'localhost', '--port', '3384',
    ], cwd=ROOT, env=child_env, stdout=log, stderr=log, start_new_session=True)
    try:
        for attempt in range(90):
            if server.poll() is not None:
                raise RuntimeError('Fixture app exited; inspect private /tmp app.log')
            try:
                urllib.request.urlopen('http://localhost:3384/login', timeout=2).close()
                break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError('Fixture app did not become ready; inspect private /tmp app.log')
        run(['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.developer-tokens.config.ts'])
    finally:
        if server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
        print('Fixture database retained for review:', name)
        print('SDK tarball SHA256:', hashlib.sha256(artifact.read_bytes()).hexdigest())

run(['pnpm', 'test', 'tests/unit/api/v1/developer-token-journey.test.ts', '--maxWorkers=1'])
