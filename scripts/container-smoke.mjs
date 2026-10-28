import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

// Deliberately accepts only local service ports, never deployment credentials or
// arbitrary URLs. PostgreSQL/Redis are disposable services created by the caller.
const [image, fullVersion, dbPortText = "5432", redisPortText = "6379", appPortText = "4321"] =
  process.argv.slice(2);
assert.match(image ?? "", /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/);
assert.match(fullVersion ?? "", /^[a-f0-9]{7,40}$/);
const port = (value) => {
  assert.match(value, /^[0-9]+$/);
  const result = Number(value);
  assert.ok(result >= 1024 && result <= 65535);
  return result;
};
const dbPort = port(dbPortText);
const redisPort = port(redisPortText);
const appPort = port(appPortText);
const prefix = `paiflow-image-smoke-${process.pid}`;
const app = `${prefix}-app`;
const rejected = `${prefix}-rejected`;
const database = `postgresql://paiflow_image:paiflow_image@127.0.0.1:${dbPort}/paiflow_image?schema=public`;
const output = (args, options = {}) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: "pipe", ...options });
const environment = [
  "-e",
  `DATABASE_URL=${database}`,
  "-e",
  "AUTH_SECRET=container-smoke-only-placeholder-at-least-32-characters",
  "-e",
  `AUTH_URL=http://127.0.0.1:${appPort}`,
  "-e",
  "STELLAR_NETWORK=testnet",
  "-e",
  "STELLAR_SOROBAN_RPC_URL_TESTNET=https://127.0.0.1:1",
  "-e",
  "STELLAR_HORIZON_URL_TESTNET=https://127.0.0.1:1",
  "-e",
  `REDIS_URL=redis://127.0.0.1:${redisPort}`,
  "-e",
  `PORT=${appPort}`,
  "-e",
  "LOG_LEVEL=error",
  "-e",
  "FILE_STORAGE_DRIVER=volume",
  "-e",
  "FILE_STORAGE_PATH=/data/files",
];
const request = async (pathname) =>
  fetch(`http://127.0.0.1:${appPort}${pathname}`, { signal: AbortSignal.timeout(3000) });

try {
  // Exercise real native/runtime modules in the final, non-root image. Marker
  // checks are API sanity only; the pinned official release establishes origin.
  output([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    image,
    "-e",
    `const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.getuid(), 1000);
assert.equal(zlib.constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17);
const input = Buffer.from('benign runtime smoke');
assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(input)), input);
for (const name of ['.env.container-smoke', 'lib/.env.container-smoke', '.worktrees/container-smoke-canary', '.git', '.aws', '.codex']) {
  assert.equal(fs.existsSync('/app/' + name), false, name + ' leaked into image');
}
for (const directory of ['/app/.docker/files', '/data/files']) {
  const file = directory + '/container-smoke';
  fs.writeFileSync(file, 'local fixture');
  fs.unlinkSync(file);
}
require('@prisma/client');
require('argon2').hash('synthetic-smoke-password').then(async hash => {
  assert.equal(await require('argon2').verify(hash, 'synthetic-smoke-password'), true);
}).catch(() => process.exitCode = 1);`,
  ]);
  assert.equal(
    output(["run", "--rm", "--network", "none", "--entrypoint", "pnpm", image, "--version"]).trim(),
    "10.4.1",
  );

  // Run the real default CMD against an unavailable local database. An image
  // that starts HTTP despite a migration failure hangs here and fails the test.
  try {
    output([
      "run",
      "--name",
      rejected,
      "--network",
      "none",
      "-e",
      "DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unreachable?connect_timeout=1",
      image,
    ]);
    throw new Error("Migration failure unexpectedly succeeded");
  } catch (error) {
    const state = JSON.parse(output(["inspect", "--format", "{{json .State}}", rejected]));
    assert.equal(state.Running, false);
    assert.ok(
      state.ExitCode > 0 && state.ExitCode !== 137,
      "Migration failure did not exit cleanly",
    );
    // Docker preserves the container's stdout/stderr streams. Prisma errors
    // are on stderr, so inspect both for this entirely synthetic failed fixture.
    const logged = spawnSync("docker", ["logs", rejected], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(logged.status, 0, "Could not read migration failure evidence");
    const logs = logged.stdout + logged.stderr;
    assert.match(logs, /\bP1001\b/, "Expected the real Prisma database-unreachable failure");
    assert.doesNotMatch(logs, /▲ Next\.js|Ready in/, "Next.js started after migration failure");
    if (error.message === "Migration failure unexpectedly succeeded") throw error;
  }

  output(["run", "-d", "--name", app, "--network", "host", ...environment, image]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await request("/login");
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* bounded wait for migrations and startup */
    }
    const state = JSON.parse(output(["inspect", "--format", "{{json .State}}", app]));
    assert.equal(state.Running, true, "Application exited during startup");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(ready, true, "Application did not become ready");
  // The first health request creates ioredis with its offline queue disabled;
  // HTTP readiness can precede that connection's ready event. Bound dependency
  // readiness separately, retain the initial observation, and require final OK.
  const dependencySamples = [];
  let health;
  for (let attempt = 0; attempt < 20; attempt++) {
    health = await (await request("/api/health")).json();
    assert.equal(
      health.version,
      fullVersion.slice(0, 7),
      "Build commit identity was not baked into image",
    );
    dependencySamples.push({ db: health.db, redis: health.redis });
    if (health.db === "ok" && health.redis === "ok") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.stdout.write(
    `Dependency readiness: ${JSON.stringify({ samples: dependencySamples.length, first: dependencySamples[0], final: dependencySamples.at(-1) })}\n`,
  );
  assert.equal(health.db, "ok", "Migrations/Prisma database connection failed");
  assert.equal(health.redis, "ok", "Redis connection failed");
  // No public RPC is contacted in this local smoke. Down/degraded is expected.
  assert.equal(health.rpc, "down");
  assert.equal(health.status, "degraded");
  assert.equal((await request("/api/deployments")).status, 401);
  output([
    "exec",
    app,
    "node",
    "-e",
    'const {PrismaClient}=require("@prisma/client"); const fs=require("node:fs"); const assert=require("node:assert/strict"); const db=new PrismaClient(); const expected=fs.readdirSync("prisma/migrations").filter(name=>fs.existsSync("prisma/migrations/"+name+"/migration.sql")).length; db.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`.then(rows=>assert.equal(rows[0].count,expected)).catch(()=>process.exitCode=1).finally(()=>db.$disconnect());',
  ]);
  output(["kill", "--signal", "TERM", app]);
  const exit = output(["wait", app], { timeout: 15_000 }).trim();
  assert.equal(exit, "0", "SIGTERM did not reach Next.js for a graceful exit");
  process.stdout.write(
    "App image smoke passed: non-root runtime/native modules, context isolation, migration gate, HTTP/identity, DB/Redis, SIGTERM. RPC deliberately unavailable.\n",
  );
} finally {
  for (const name of [app, rejected]) {
    try {
      output(["rm", "-f", name]);
    } catch {
      /* remove only containers owned by this smoke */
    }
  }
}
