/** Local production-browser rehearsal: node tests/zod-csp.mjs.
 * Uses the real startup hook, CSP, schemas and resolvers in a disposable app.
 * No database, wallet profile, hosted environment or financial action is used.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await mkdtemp(path.join(tmpdir(), "paiflow-zod-csp-"));
const next = path.join(root, "node_modules/next/dist/bin/next");
const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
const children = new Set();
let browser;
async function write(name, value) {
  const target = path.join(fixture, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
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
  return { child, output: () => output, exit: once(child, "exit").then(([code]) => code) };
}
async function bounded(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"));
  await write("package.json", JSON.stringify({ name: "zod-csp-fixture", private: true }));
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
  await write("next.config.mjs", "export default { experimental: { cpus: 1 } };\n");
  for (const name of [
    "instrumentation-client.ts",
    "lib/csp.ts",
    "lib/subscription/schema.ts",
    "lib/address-book/schema.ts",
    "lib/stellar/strkey.ts",
  ]) {
    await mkdir(path.dirname(path.join(fixture, name)), { recursive: true });
    await cp(path.join(root, name), path.join(fixture, name));
  }
  await write(
    "middleware.ts",
    `import { NextResponse, type NextRequest } from "next/server";
import { cspHeader } from "./lib/csp";
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  const policy = cspHeader("c3RyaWN0LWNzcC1yZWhlYXJzYWw=", false);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}`,
  );
  await write(
    "app/layout.tsx",
    "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  await write(
    "app/probe.tsx",
    `"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AllowancePrepareSchema } from "@/lib/subscription/schema";
import { CreateAddressContactSchema } from "@/lib/address-book/schema";
const moduleSchema = z.object({ label: z.string() });
const wallet = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
export default function Page() {
  const [status, setStatus] = useState("loading");
  useEffect(() => { setStatus(moduleSchema.parse({ label: "ready" }).label); }, []);
  return <><output>{status}</output><button onClick={async () => {
    const options = { fields: {}, shouldUseNativeValidation: false };
    const pay = await zodResolver(AllowancePrepareSchema)({ userAddress: wallet, amount: "90071992547409931234567" }, undefined, options);
    const split = await zodResolver(CreateAddressContactSchema)({address:wallet,label:" Contact "}, undefined, options);
    const object = z.object({ value: z.string() }).parse({ value: "ok" });
    const invalid = z.object({ value: z.string() }).safeParse({ value: 1 });
    if (pay.values.amount === "90071992547409931234567" && split.values.label === "Contact" && split.values.createOnly === false && object.value === "ok" && !invalid.success) setStatus("validated");
    else setStatus("failed");
  }}>Validate forms</button></>;
}`,
  );
  await write(
    "app/page.tsx",
    'import Probe from "./probe"; export const dynamic = "force-dynamic"; export default function Page() { return <Probe />; }\n',
  );
  const build = start(["build"]);
  assert.equal(await bounded(build.exit, 180_000, "Fixture build"), 0, build.output());
  const server = start(["start", "-p", "0", "-H", "127.0.0.1"]);
  await bounded(
    (async () => {
      while (!server.output().includes("Ready in")) {
        if (server.child.exitCode !== null) throw new Error(server.output());
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })(),
    20_000,
    "Fixture startup",
  );
  const port = server.output().match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(port, server.output());
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const violations = [];
  const errors = [];
  await page.exposeFunction("recordCspViolation", (value) => violations.push(value));
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      window.recordCspViolation({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(`http://127.0.0.1:${port}`);
  assert.equal(response.status(), 200);
  assert.ok(!response.headers()["content-security-policy"].includes("unsafe-eval"));
  try {
    await page.getByText("ready", { exact: true }).waitFor();
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ violations, errors, text: await page.locator("body").innerText() }) + "\n",
    );
    throw error;
  }
  await page.getByRole("button", { name: "Validate forms" }).click();
  await page.getByText("validated", { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "Production Next strict-CSP schema/form rehearsal passed with no policy violations.\n",
  );
} finally {
  await browser?.close();
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.allSettled(
    [...children].map((child) =>
      child.exitCode === null
        ? bounded(once(child, "exit"), 10_000, "Fixture shutdown")
        : Promise.resolve(),
    ),
  );
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  await rm(fixture, { recursive: true, force: true });
}
