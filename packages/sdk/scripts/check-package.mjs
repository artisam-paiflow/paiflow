import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = resolve(packageRoot, "../../node_modules/typescript/bin/tsc");
const scratch = await mkdtemp(join(tmpdir(), "paiflow-sdk-consumer-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  // Ignore lifecycle scripts here: the caller already built the exact candidate.
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], packageRoot),
  );
  assert.ok(packed, "npm pack must produce one artifact");
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.name, "@paiflow/sdk");
  assert.equal(metadata.type, "module");
  assert.deepEqual(metadata.dependencies ?? {}, {}, "SDK scaffold has no runtime dependencies");
  assert.equal(packed.name, metadata.name);
  assert.equal(packed.version, metadata.version);
  const paths = packed.files.map((file) => file.path);
  for (const required of [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    assert.ok(paths.includes(required), `Missing artifact file: ${required}`);
  }
  for (const path of paths) {
    assert.ok(
      ["package.json", "README.md", "CHANGELOG.md", "LICENSE"].includes(path) ||
        /^dist\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:js|d\.ts)$/.test(path),
      `Unexpected artifact file: ${path}`,
    );
  }
  const consumer = join(scratch, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(scratch, packed.filename),
    ],
    consumer,
  );
  await writeFile(
    join(consumer, "smoke.mjs"),
    `
import assert from "node:assert/strict";
import * as sdk from "@paiflow/sdk";
assert.equal(typeof sdk.PaiflowTransport, "function");
const transport = new sdk.PaiflowTransport({ baseUrl: "https://example.com", fetch: async () => new Response(JSON.stringify({data: true})) });
assert.equal((await transport.request({path: "/api/v1/openapi.json", method: "GET", auth: {kind: "public"}, parse: value => value})).data, true);
await assert.rejects(import("@paiflow/sdk/dist/index.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
`,
  );
  run(process.execPath, ["smoke.mjs"], consumer);
  await writeFile(
    join(consumer, "smoke.ts"),
    `
import * as sdk from "@paiflow/sdk";
const module: typeof import("@paiflow/sdk") = sdk;
const transport = new module.PaiflowTransport({ baseUrl: "https://example.com" });
const result: Promise<sdk.ApiResponse<boolean>> = transport.request({path: "/api/v1/openapi.json", method: "GET", auth: {kind: "public"}, parse: value => {
  if (typeof value !== "boolean") throw new Error("Expected boolean");
  return value;
}});
void result;
// @ts-expect-error Package internals are deliberately not exported.
import "@paiflow/sdk/dist/index.js";
`,
  );
  run(
    process.execPath,
    [
      compiler,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--noUncheckedSideEffectImports",
      "smoke.ts",
    ],
    consumer,
  );
  process.stdout.write(
    "SDK tarball: file allowlist, clean ESM import, export boundary and declarations passed.\n",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
