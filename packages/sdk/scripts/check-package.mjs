import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
assert.equal("signPreparedEnvelope" in sdk, false);
const funding = new sdk.Paiflow({baseUrl: "https://example.com", token: "pfk_test", fetch: async () => new Response(JSON.stringify({data: {intent: "11111111-1111-4111-8111-111111111111", action: "schedule.fund", txHash: "a".repeat(64), network: "testnet", state: "SUBMITTING", expiresAt: "2000-01-01T00:00:00Z"}}))}).deployment("11111111-1111-4111-8111-111111111111");
assert.equal((await funding.funding.reconcile({action: "schedule.fund", intent: "11111111-1111-4111-8111-111111111111"})).data.state, "SUBMITTING");
assert.equal(typeof funding.funding.signPrepared, "function");
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
const fundingDiscovery: Promise<sdk.ApiResponse<sdk.FundingDiscovery>> = deployment.funding.get();
const fundingPrepared: Promise<sdk.ApiResponse<sdk.FundingPrepared>> = deployment.funding.prepare({fromAddress: "wallet", tokenContractAddress: "contract", amountStroops: "1"});
const fundingSubmitted: Promise<sdk.ApiResponse<sdk.FundingSubmitted>> = deployment.funding.submit({action: "schedule.fund", intent: "uuid", signedXdr: "signed"});
const fundingReconciled: Promise<sdk.ApiResponse<sdk.FundingReconciled>> = deployment.funding.reconcile({action: "webhook.fund", intent: "uuid"});
async function fundingSigning(p: sdk.ApiResponse<sdk.FundingPrepared>) {
  const signed = await deployment.funding.signPrepared(p, signer, {walletAddress: "wallet"});
  const body: sdk.FundingSubmitInput = signed.submission;
  const original: sdk.ApiResponse<sdk.FundingPrepared> = signed.preparation;
  void [body, original];
}
// @ts-expect-error Funding money requires canonical string amounts.
deployment.funding.prepare({fromAddress: "wallet", tokenContractAddress: "contract", amountStroops: 1});
// @ts-expect-error Funding requires exact funding actions.
deployment.funding.reconcile({action: "schedule.pause", intent: "uuid"});
// @ts-expect-error Funding reconciliation has no replacementAllowed field.
const inventedReplacement: boolean = ({} as sdk.FundingReconciled).replacementAllowed;
const scheduleState: Promise<sdk.ApiResponse<sdk.ScheduleState>> = deployment.schedule.get({nodeId: "schedule"});
const schedulePrepared: Promise<sdk.ApiResponse<sdk.SchedulePrepared<"retrieve">>> = deployment.schedule.retrieve.prepare({walletAddress: "wallet"});
async function scheduleSigning(p: sdk.ApiResponse<sdk.SchedulePrepared<"pause">>) {
 const signed = await deployment.schedule.pause.signPrepared(p, signer, {walletAddress: "wallet"});
 const receipt: Promise<sdk.ApiResponse<sdk.ScheduleSubmitted>> = deployment.schedule.pause.submit(signed.submission, signed.submissionOptions);
 return receipt;
}
async function scheduleTypes() {
 const p = await deployment.schedule.pause.prepare({walletAddress: "wallet"});
 // @ts-expect-error Only retrieve preparations contain an estimated amount.
 p.data.estimatedAmountStroops;
 const r = await deployment.schedule.retrieve.prepare({walletAddress: "wallet"});
 const amount: string = r.data.estimatedAmountStroops;
 // @ts-expect-error Different action preparations cannot be signed by pause namespace.
 deployment.schedule.pause.signPrepared(r, signer, {walletAddress: "wallet"});
 // @ts-expect-error Caller cannot select retrieval amount.
 deployment.schedule.retrieve.prepare({walletAddress: "wallet", amountStroops: "1"});
 return amount;
}
const subscriptionState: Promise<sdk.ApiResponse<sdk.SubscriptionState>> = deployment.subscription.get();
async function subscriptionTypes() {
 const p = await deployment.subscription.cancel.prepare({walletAddress: "wallet"});
 const signed = await deployment.subscription.cancel.signPrepared(p, signer, {walletAddress: "wallet"});
 const receipt: Promise<sdk.ApiResponse<sdk.SubscriptionSubmitted>> = deployment.subscription.cancel.submit(signed.submission, signed.submissionOptions);
 const r = await deployment.subscription.cancel.reconcile({intent: p.data.intent});
 const ledger: number | null = r.data.ledger;
 // @ts-expect-error Cancellation preparations cannot be signed as reactivation.
 deployment.subscription.reactivate.signPrepared(p, signer, {walletAddress: "wallet"});
 const state = await deployment.subscription.allowance.get();
 // @ts-expect-error Public state omits the partner templateKind field.
 state.data.templateKind;
 const approval = await deployment.subscription.allowance.prepare({amount: "1", userAddress: "wallet"});
 const signedApproval = await deployment.subscription.allowance.signPrepared(approval, state, signer, {walletAddress: "wallet"});
 const allowanceReceipt: Promise<sdk.ApiResponse<sdk.AllowanceStatus>> = deployment.subscription.allowance.submit(signedApproval.submission);
 // @ts-expect-error Public preparation has no expiry field.
 approval.data.expiresAt;
 // @ts-expect-error Approval amounts must be strings.
 deployment.subscription.allowance.prepare({amount: 1, userAddress: "wallet"});
 const status = await deployment.subscription.allowance.status({intent: approval.data.intent});
 // @ts-expect-error Public status has no replacementAllowed field.
 status.data.replacementAllowed;
 return [receipt, allowanceReceipt, ledger];
}
const webhookAttempt: Promise<sdk.ApiResponse<sdk.WebhookAttempt>> = deployment.webhook.trigger(
 {escrow: true, amount: "10000000"}, {webhookSecret: "configured", idempotencyKey: "persisted-event"});
const nativeAttempt = deployment.webhook.trigger({from: "wallet", amount: "1", auth: ["signed-entry"]}, {webhookSecret: "configured", idempotencyKey: "native-event"});
const unkeyed: Promise<sdk.ApiResponse<sdk.WebhookUnkeyedResult>> = deployment.webhook.triggerUnkeyed({escrow: true}, {webhookSecret: "configured"});
const released: Promise<sdk.ApiResponse<sdk.Released>> = deployment.releaseEarly({nodeId: "deadline"});
// @ts-expect-error Keyed triggers require a caller-persisted key.
deployment.webhook.trigger({escrow: true}, {webhookSecret: "configured"});
// @ts-expect-error Webhook secrets cannot be inherited from a deployment token.
deployment.webhook.trigger({escrow: true}, {idempotencyKey: "event"});
// @ts-expect-error Stroops must be strings.
deployment.webhook.trigger({escrow: true, amount: 1}, {webhookSecret: "configured", idempotencyKey: "event"});
// @ts-expect-error Native webhook execution needs the funding address.
deployment.webhook.trigger({amount: "1"}, {webhookSecret: "configured", idempotencyKey: "event"});
// @ts-expect-error Legacy unkeyed responses do not invent network metadata.
const legacyNetwork = ({} as sdk.WebhookUnkeyedResult).network;
void [webhookAttempt, nativeAttempt, unkeyed, released, legacyNetwork];
void [subscriptionState, subscriptionTypes];
void [scheduleState, schedulePrepared, scheduleSigning, scheduleTypes];
void [fundingDiscovery, fundingPrepared, fundingSubmitted, fundingReconciled, fundingSigning, inventedReplacement];
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
  // Consumer-only optional Stellar dependency and Node declarations come from
  // existing dev installation; SDK itself remains dependency-free and packed.
  for (const [name, source] of [
    ["@stellar/stellar-sdk", "../../node_modules/@stellar/stellar-sdk"],
    ["@types/node", "../../node_modules/@types/node"],
  ]) {
    const target = join(consumer, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(resolve(packageRoot, source), target);
  }
  const examples = join(consumer, "examples");
  await cp(join(packageRoot, "examples"), examples, { recursive: true });
  // Stellar SDK currently lacks js-xdr declarations; skip dependency internals
  // only for these optional consumer examples. SDK-only declaration smoke stays strict.
  run(
    process.execPath,
    [
      compiler,
      "--strict",
      "--skipLibCheck",
      "true",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      "--types",
      "node",
      "--outDir",
      "examples/compiled",
      "examples/payment-server.ts",
      "examples/payment-browser.ts",
      "examples/workflows.ts",
    ],
    consumer,
  );
  process.stdout.write(run(process.execPath, ["examples/check-examples.mjs"], consumer));
  process.stdout.write(
    "SDK tarball: file allowlist, clean ESM import, export boundary and declarations passed.\n",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
