/** Production Next lifecycle regression. Run: node tests/sse-shutdown.mjs
 * Builds a disposable app containing the real SSE modules and instrumentation,
 * with an in-memory subscriber. No database, wallets, or hosted service touched.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await mkdtemp(path.join(tmpdir(), "paiflow-sse-shutdown-"));
const next = path.join(root, "node_modules/next/dist/bin/next");
const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
delete env.SENTRY_DSN;
delete env.NEXT_MANUAL_SIG_HANDLE;
const children = new Set();
async function write(name, text) {
  const filename = path.join(fixture, name);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, text);
}
function start(args) {
  const child = spawn(process.execPath, [next, ...args], {
    cwd: fixture,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exit = once(child, "exit").then(([code, signal]) => ({ code, signal }));
  return { child, exit, output: () => output };
}
async function bounded(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${description} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function waitReady(server) {
  const startTime = Date.now();
  while (!server.output().includes("Ready in")) {
    if (server.child.exitCode !== null) throw new Error(server.output());
    if (Date.now() - startTime > 20000) throw new Error(server.output());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const match = server.output().match(/localhost:(\d+)/);
  assert.ok(match, server.output());
  return `http://localhost:${match[1]}`;
}

try {
  await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"));
  await write("package.json", JSON.stringify({ name: "sse-shutdown-fixture", private: true }));
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "esnext"],
        strict: true,
        skipLibCheck: true,
        moduleResolution: "bundler",
        esModuleInterop: true,
        paths: { "@/*": ["./*"] },
      },
    }),
  );
  await write(
    "next.config.mjs",
    "export default { experimental: { cpus: 1 }, serverExternalPackages: ['ioredis'] };\n",
  );
  for (const name of ["server-shutdown", "deployment-event-streams", "deployment-event-response"]) {
    await mkdir(path.join(fixture, "lib"), { recursive: true });
    await cp(path.join(root, "lib", `${name}.ts`), path.join(fixture, "lib", `${name}.ts`));
  }
  await cp(path.join(root, "instrumentation.ts"), path.join(fixture, "instrumentation.ts"));
  await write("sentry.server.config.ts", "export async function initSentryServer() {}\n");
  await write("sentry.edge.config.ts", "export async function initSentryEdge() {}\n");
  await write(
    "lib/log.ts",
    `const emit = (context: object, message: string) => process.stdout.write(JSON.stringify({ ...context, message }) + "\\n"); export const log = { info: emit, warn: emit, error: emit };\n`,
  );
  await write(
    "lib/deployments/service-work.ts",
    "export async function assertDeploymentService(_id: string) {}\n",
  );
  await write(
    "lib/redis.ts",
    `
import { EventEmitter } from "node:events";
import type Redis from "ioredis";
class Subscriber extends EventEmitter {
  status = "ready";
  async subscribe(channel: string) {
    if (channel.includes("pending-subscribe")) await new Promise(resolve => setTimeout(resolve, 1000));
    return 1;
  }
  async unsubscribe() { return 0; }
  disconnect() { this.status = "end"; this.emit("close"); }
}
const shared = globalThis as typeof globalThis & { fixtureSubscriber?: Subscriber };
export function redisSub() { return (shared.fixtureSubscriber ??= new Subscriber()) as unknown as Redis; }
export const eventChannel = (id: string) => "events:" + id;
`,
  );
  await write(
    "app/layout.tsx",
    `export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`,
  );
  await write(
    "app/page.tsx",
    "export default function Page() { return <div>SSE shutdown fixture</div>; }\n",
  );
  await write(
    "app/api/events/[id]/route.ts",
    `
import { deploymentEventResponse } from "@/lib/deployment-event-response";
import { redisSub } from "@/lib/redis";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (id === "pending-ready") redisSub().status = "connecting";
  return deploymentEventResponse(id, req.signal, async () => {});
}
`,
  );
  await write(
    "app/api/stats/route.ts",
    `
import { deploymentEventStreams } from "@/lib/deployment-event-streams";
export const dynamic = "force-dynamic";
export function GET() { return Response.json(deploymentEventStreams()?.counts); }
`,
  );
  const build = start(["build"]);
  const built = await bounded(build.exit, 120000, "Production fixture build");
  assert.equal(built.code, 0, build.output());
  const results = [];
  for (const [signal, ids, connected] of [
    ["SIGTERM", ["a"], true],
    ["SIGTERM", ["a", "a", "b"], true],
    ["SIGINT", ["a", "a"], true],
    ["SIGTERM", ["pending-ready"], false],
    ["SIGTERM", ["pending-subscribe"], false],
  ]) {
    const server = start(["start", "-p", "0"]);
    try {
      const origin = await waitReady(server);
      const opening = Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`${origin}/api/events/${id}`);
          assert.equal(response.status, 200);
          const reader = response.body.getReader();
          if (connected) {
            let text = "";
            while (!text.includes("event: connected")) {
              const chunk = await bounded(reader.read(), 5000, "Stream connection");
              assert.equal(chunk.done, false);
              text += new TextDecoder().decode(chunk.value);
            }
          }
          return reader;
        }),
      );
      // A stream waiting for setup has not flushed its HTTP headers yet. Check
      // server registrations before signalling rather than awaiting fetch/EOF.
      if (!connected) {
        await bounded(
          (async () => {
            while (true) {
              const counts = await (await fetch(`${origin}/api/stats`)).json();
              if (counts?.viewers === ids.length) break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          })(),
          2000,
          "Pending setup registration",
        );
      } else await bounded(opening, 5000, "Connected streams");
      const started = performance.now();
      server.child.kill(signal);
      const status = await bounded(server.exit, 10000, "Graceful Next shutdown");
      assert.deepEqual(status, { code: 0, signal: null }, server.output());
      const streams = await bounded(opening, 2000, "Shutdown response headers");
      for (const reader of streams) {
        const end = await bounded(reader.read(), 2000, "SSE EOF");
        assert.equal(end.done, true);
      }
      assert.match(server.output(), /SSE shutdown cleanup completed/);
      assert.ok(!server.output().includes("ELIFECYCLE"));
      const result = {
        requestedSignal: signal,
        streams: ids.length,
        setup: connected ? "connected" : ids[0],
        ...status,
        milliseconds: Math.round(performance.now() - started),
      };
      results.push(result);
      process.stdout.write(JSON.stringify(result) + "\n");
    } finally {
      if (server.child.exitCode === null) server.child.kill("SIGKILL");
    }
  }
  process.stdout.write(`Production shutdown scenarios passed: ${results.length}\n`);
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  await rm(fixture, { recursive: true, force: true });
}
