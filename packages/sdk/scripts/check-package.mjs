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
const reads = new sdk.Paiflow({baseUrl: "https://example.com", fetch: async () => new Response(JSON.stringify({data: {paused: true, available: "9007199254740993", retrieveAllowed: false}}))});
const deployment = reads.deployment("11111111-1111-4111-8111-111111111111");
assert.equal((await deployment.publicSchedule.get()).data.available, "9007199254740993");
assert.equal(deployment.urls.embed(), "https://example.com/deployments/11111111-1111-4111-8111-111111111111/embed");
const payment = new sdk.Paiflow({baseUrl: "https://example.com", token: "pfk_test", fetch: async () => new Response(JSON.stringify({data: {txHash: "a".repeat(64), status: "FAILED", error: {code: "ONCHAIN_FAILED", message: "failed"}}}))});
assert.equal((await payment.deployment("11111111-1111-4111-8111-111111111111").execute.submit({signedXdr: "signed-envelope"})).data.status, "FAILED");
assert.equal(typeof sdk.signPrepared, "function");
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
const client = new sdk.Paiflow({baseUrl: "https://example.com", token: "pfk_test"});
const deployment = client.deployment("11111111-1111-4111-8111-111111111111");
const balances: Promise<sdk.ApiResponse<sdk.DeploymentBalances>> = deployment.balances.get();
const capabilities: Promise<sdk.ApiResponse<sdk.DeploymentCapabilities>> = deployment.capabilities.get();
const quote: Promise<sdk.ApiResponse<sdk.SwapQuote>> = deployment.swap.quote({amountStroops: "9007199254740993"});
const pages: AsyncGenerator<sdk.ApiResponse<sdk.ListEventsResponse>> = deployment.events.pages({limit: 50}, {maxPages: 10});
const stream: AsyncGenerator<sdk.ApiResponse<sdk.PublicEmbedMessage>> = deployment.embed.stream();
async function snapshot() {for await (const item of stream) {if (item.data.event === "snapshot") {const amount: string | undefined = item.data.snapshot.events[0]?.amountStroops; void amount;}}}
const preparation: Promise<sdk.ApiResponse<sdk.ExecutePrepared>> = deployment.execute.prepare({amount: "1", from: "wallet"});
const submitted: Promise<sdk.ApiResponse<sdk.ExecuteSubmitted>> = deployment.execute.submit({signedXdr: "signed"}, {wait: false});
const publicPreparation: Promise<sdk.ApiResponse<sdk.PublicPaymentPrepared>> = deployment.publicPayment.prepare({amount: "1", userAddress: "wallet"});
const publicStatus: Promise<sdk.ApiResponse<sdk.PublicPaymentStatus>> = deployment.publicPayment.status("hash");
const signer: sdk.SignTransaction = async request => ({signedXdr: request.xdr});
async function signing(p: sdk.ApiResponse<sdk.ExecutePrepared>) {const signed = await sdk.signPrepared(p, signer, {walletAddress: "wallet"}); const original: sdk.ExecutePrepared = signed.preparation.data; void original;}
void [balances, capabilities, quote, pages, snapshot, preparation, submitted, publicPreparation, publicStatus, signing];
// @ts-expect-error SDK payment amount requires a string.
deployment.execute.prepare({amount: 1, from: "wallet"});
// @ts-expect-error Legacy public preparation never invents expiry.
const inventedExpiry: string = ({} as sdk.PublicPaymentPrepared).expiresAt;
// @ts-expect-error Callback returns signedXdr object, not a private key or raw string.
const invalidSigner: sdk.SignTransaction = async () => "secret";
void [inventedExpiry, invalidSigner];
// @ts-expect-error SDK amounts are integer strings, never JS floating point.
deployment.swap.quote({amountStroops: 1.2});
// @ts-expect-error Package internals are deliberately not exported.
import "@paiflow/sdk/dist/read-parsers.js";
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
