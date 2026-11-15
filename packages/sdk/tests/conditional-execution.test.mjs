import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  Paiflow,
  selectConditionalExecutionBranch,
  signPrepared,
  PaiflowMalformedResponseError,
  PaiflowApiError,
  PaiflowAbortError,
  PaiflowTimeoutError,
} from "../dist/index.js";
import {
  parseConditionalDefinition,
  parseConditionalExecutionIntent,
  parseConditionalExecutionDiscovery,
  parseConditionalExecutePrepared,
} from "../dist/conditional-execution.js";
const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/conditional-execution.json", import.meta.url), "utf8"),
);
const clone = (value) => structuredClone(value);
const original = fixtures.scenarios.find((s) => s.name === "amount_gt-split-return_to_owner")
  .intents[2];
const id = original.deploymentId,
  intentId = "12251225-1225-4225-8225-122512251225",
  txHash = "cd".repeat(32);
const passphrase = "Test SDF Network ; September 2015";
const request = (intent) => ({
  amount: intent.amountStroops,
  from: intent.payer,
  arguments: clone(intent.arguments),
});
const receipt = (execution = original) => ({
  intent: intentId,
  txHash,
  walletAddress: execution.payer,
  xdr: "unsigned-original-envelope",
  expiresAt: "2099-01-01T00:00:00.000Z",
  network: "testnet",
  networkPassphrase: passphrase,
  execution: clone(execution),
});
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id);
for (const scenario of fixtures.scenarios)
  for (const intent of scenario.intents)
    test(`v2 strict route ${scenario.name} funded ${intent.amountStroops}`, () => {
      assert.deepEqual(parseConditionalExecutionIntent(intent), intent);
      assert.deepEqual(
        parseConditionalExecutePrepared(receipt(intent), request(intent), id),
        receipt(intent),
      );
      if (intent.amountAtConditionStroops === intent.definition.condition.thresholdStroops)
        assert.equal(intent.selectedBranch, "false");
    });
test("explicit conditional namespace preserves query, key, receipt, signing and original identity", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: new URL(url), init });
    return response(
      calls.length === 1
        ? fixtures.discovery
        : calls.length === 2
          ? receipt()
          : { txHash, status: "UNKNOWN" },
      { "x-history-request-id": intentId },
    );
  });
  const state = await d.execute.conditional.state();
  assert.equal(state.data.policyVersion, 2);
  const p = await d.execute.conditional.prepare(request(original), {
    idempotencyKey: "order:conditional",
  });
  const signed = await signPrepared(
    p,
    async (context) => {
      assert.equal(context.xdr, p.data.xdr);
      assert.equal(context.walletAddress, original.payer);
      return { signedXdr: "original-signed-envelope" };
    },
    { walletAddress: original.payer, expectedNetwork: "testnet" },
  );
  assert.equal(signed.preparation, p);
  const submitted = await d.execute.conditional.submit(signed.submission, {
    ...signed.submissionOptions,
    wait: false,
  });
  assert.equal(submitted.data.status, "UNKNOWN");
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.url.searchParams.get("version"), "2");
  assert.equal(calls[1].init.headers.get("Idempotency-Key"), "order:conditional");
  assert.deepEqual(JSON.parse(calls[1].init.body), request(original));
  assert.equal(calls[2].url.searchParams.get("wait"), "false");
  assert.equal(calls[2].init.headers.get("x-preparation-request-id"), intentId);
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    intent: intentId,
    signedXdr: "original-signed-envelope",
  });
});
for (const [name, mutate] of [
  ["v1 intent", (v) => (v.version = 1)],
  ["unknown receipt field", (v) => (v.privateContact = "private")],
  ["inactive missing node", (v) => v.nodes.pop()],
  ["inactive hash malformed", (v) => (v.nodes.at(-1).wasmHash = "unknown")],
  ["duplicate binding", (v) => (v.nodes.at(-1).contractAddress = v.nodes[0].contractAddress)],
  ["swapped branches", (v) => ([v.nodes[3], v.nodes[4]] = [v.nodes[4], v.nodes[3]])],
  ["wrong root", (v) => (v.rootContract = v.nodes.at(-1).contractAddress)],
  ["root revision", (v) => (v.nodes[0].expectedRevision = "1")],
  ["owner return revision", (v) => (v.nodes.at(-1).expectedRevision = "1")],
  ["revision overflow", (v) => (v.nodes[1].expectedRevision = (1n << 64n).toString())],
  ["wrong asset", (v) => (v.assetContract = v.rootContract)],
  ["wrong selected branch", (v) => (v.selectedBranch = "false")],
  ["wrong post-prefix amount", (v) => (v.amountAtConditionStroops = v.amountStroops)],
  ["caller threshold input", (v) => (v.arguments.thresholdStroops = "1")],
  [
    "inactive branch input",
    (v) => v.arguments.inputs.push({ kind: "pay", nodeId: "no", recipient: v.payer }),
  ],
  [
    "constant prefix override",
    (v) => v.arguments.inputs.unshift({ kind: "pay", nodeId: "fee", recipient: v.payer }),
  ],
  ["missing selected input", (v) => (v.arguments.inputs = [])],
  [
    "configured constant override",
    (v) => (v.arguments.inputs[0].rows = [{ rowId: "platform", recipient: v.payer }]),
  ],
  ["negative threshold", (v) => (v.definition.condition.thresholdStroops = "-1")],
  ["per-payment threshold mode", (v) => (v.definition.condition.thresholdMode = "execution")],
  ["full prefix", (v) => (v.definition.prefix[0].configuration.payoutValue = { kind: "full" })],
  ["prefix zero", (v) => (v.definition.prefix[0].configuration.payoutValue.amountStroops = "0")],
  [
    "fixed overflow",
    (v) =>
      (v.definition.prefix[0].configuration.payoutValue.amountStroops = (1n << 127n).toString()),
  ],
  [
    "extra allocation metadata",
    (v) => (v.definition.trueBranch.configuration.configuredRows[0].allocation.contact = "private"),
  ],
])
  test(`rejects ${name}`, () => {
    const value = clone(original);
    mutate(value);
    assert.throws(() => parseConditionalExecutionIntent(value));
  });
for (const [name, mutate] of [
  [
    "payer",
    (v) => {
      v.execution.payer = v.execution.definition.owner;
      v.walletAddress = v.execution.payer;
    },
  ],
  [
    "amount",
    (v) => {
      v.execution.amountStroops = "112";
      v.execution.amountAtConditionStroops = "102";
    },
  ],
  ["deployment", (v) => (v.execution.deploymentId = intentId)],
  ["network", (v) => (v.network = "mainnet")],
  ["network hash", (v) => (v.execution.networkPassphraseHash = "ab".repeat(32))],
  ["wallet", (v) => (v.walletAddress = v.execution.definition.owner)],
  [
    "inputs",
    (v) => (v.execution.arguments.inputs[0].additionalRecipients[0].recipient = v.execution.payer),
  ],
  ["unknown outer field", (v) => (v.privateContact = "private")],
])
  test(`prepare rejects canonical ${name} mismatch`, async () => {
    const value = receipt();
    mutate(value);
    const d = setup(async () => response(value));
    await assert.rejects(
      d.execute.conditional.prepare(request(original)),
      PaiflowMalformedResponseError,
    );
  });
test("requires normalized positive amounts and explicit v2 inputs before any request", () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response(receipt());
  });
  for (const input of [
    { ...request(original), amount: "01" },
    { ...request(original), amount: "0" },
    { amount: "1", from: original.payer },
    { ...request(original), arguments: { version: 1, inputs: [] } },
    { ...request(original), privateContact: "private" },
  ])
    assert.throws(() => d.execute.conditional.prepare(input), TypeError);
  assert.equal(calls, 0);
});
test("default v1 SDK still refuses v2 receipts and v2 methods refuse v1 responses", async () => {
  const calls = [];
  const d = setup(async (url) => {
    calls.push(String(url));
    return response(receipt());
  });
  await assert.rejects(
    d.execute.prepare({ amount: original.amountStroops, from: original.payer }),
    PaiflowMalformedResponseError,
  );
  assert.equal(new URL(calls[0]).searchParams.has("version"), false);
  const v1 = receipt();
  v1.execution.version = 1;
  await assert.rejects(
    setup(async () => response(v1)).execute.conditional.prepare(request(original)),
    PaiflowMalformedResponseError,
  );
});
test("current discovery binds both branch states, owner and revision evidence", () => {
  assert.deepEqual(parseConditionalExecutionDiscovery(fixtures.discovery), fixtures.discovery);
  for (const mutate of [
    (v) => (v.statuses.at(-1).state.configuration.recipient = original.payer),
    (v) => (v.statuses.at(-1).state.parentContract = v.nodes[1].contractAddress),
    (v) => (v.statuses[0].obligationsStroops = "1"),
    (v) => (v.nodes.at(-1).expectedRevision = "1"),
    (v) => (v.statuses[3].state.revision = "1"),
    (v) => (v.privateContact = "private"),
    (v) => v.statuses.pop(),
  ]) {
    const value = clone(fixtures.discovery);
    mutate(value);
    assert.throws(() => parseConditionalExecutionDiscovery(value));
  }
  const unsupported = {
    version: 2,
    supported: false,
    policyVersion: 0,
    deploymentId: id,
    network: "testnet",
    reason: "Unsupported generation",
  };
  assert.deepEqual(parseConditionalExecutionDiscovery(unsupported), unsupported);
  assert.throws(() => parseConditionalExecutionDiscovery({ ...unsupported, version: 1 }));
});
test("prefix deductions change routing; threshold zero/max and equality are strict", () => {
  const base = clone(original);
  base.definition.trueBranch = { kind: "return_to_owner", nodeId: "yes" };
  base.arguments.inputs = [];
  for (const comparison of ["amount_gt", "amount_lt"]) {
    for (const threshold of ["0", (2n ** 127n - 1n).toString(), "101"]) {
      const v = clone(base);
      v.definition.condition.kind = comparison;
      v.definition.condition.thresholdStroops = threshold;
      const truth =
        comparison === "amount_gt" ? 101n > BigInt(threshold) : 101n < BigInt(threshold);
      v.selectedBranch = truth ? "true" : "false";
      assert.equal(parseConditionalExecutionIntent(v).selectedBranch, v.selectedBranch);
    }
  }
  const value = clone(base);
  value.definition.condition.thresholdStroops = "105";
  value.selectedBranch = "false";
  assert.equal(parseConditionalExecutionIntent(value).selectedBranch, "false"); //111>105 but101<105
});
test("fixed execution Split requires exact funding while configured Split can accumulate", () => {
  const v = clone(original);
  v.definition.prefix = [];
  v.nodes.splice(1, 1);
  v.definition.condition.thresholdStroops = "0";
  v.amountStroops = "100";
  v.amountAtConditionStroops = "100";
  const split = v.definition.trueBranch;
  split.policy.allocationMode = "fixed";
  split.configuration.configuredRows[0].allocation = { kind: "fixed", amountStroops: "10" };
  v.arguments.inputs[0].additionalRecipients[0].allocation = { kind: "fixed", amountStroops: "90" };
  assert.equal(parseConditionalExecutionIntent(v).amountStroops, "100");
  const wrong = clone(v);
  wrong.amountStroops = "99";
  wrong.amountAtConditionStroops = "99";
  assert.throws(() => parseConditionalExecutionIntent(wrong));
  const configured = clone(v);
  configured.definition.trueBranch.policy.additionalRecipients = "constant";
  configured.definition.trueBranch.policy.rows.push({
    rowId: "worker",
    recipient: "constant",
    allocation: "constant",
  });
  configured.definition.trueBranch.configuration.configuredRows.push(
    configured.arguments.inputs[0].additionalRecipients[0],
  );
  configured.arguments.inputs = [];
  configured.amountStroops = "40";
  configured.amountAtConditionStroops = "40";
  assert.equal(parseConditionalExecutionIntent(configured).amountStroops, "40");
});
test("lost prepare/submit responses keep explicit original key/envelope and never auto-retry", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: new URL(url), init });
    if (calls.length === 1 || calls.length === 3)
      return new Response(JSON.stringify({ error: { code: "UPSTREAM_RPC", message: "unknown" } }), {
        status: 502,
      });
    return response(calls.length === 2 ? receipt() : { txHash, status: "UNKNOWN" });
  });
  const input = request(original),
    options = { idempotencyKey: "saved-key" };
  await assert.rejects(d.execute.conditional.prepare(input, options), PaiflowApiError);
  assert.equal(calls.length, 1);
  const p = await d.execute.conditional.prepare(input, options);
  assert.equal(p.data.intent, intentId);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(
    calls[0].init.headers.get("idempotency-key"),
    calls[1].init.headers.get("idempotency-key"),
  );
  const submission = { signedXdr: "same-signed-original", intent: intentId };
  await assert.rejects(d.execute.conditional.submit(submission), PaiflowApiError);
  assert.equal(calls.length, 3);
  await d.execute.conditional.submit(submission);
  assert.equal(calls[2].init.body, calls[3].init.body);
});
test("reconcile requests and response identity stay on the original v2 intent", async () => {
  let call;
  const d = setup(async (url, init) => {
    call = { url: new URL(url), init };
    return response({
      intent: intentId,
      state: "SUBMITTING",
      transaction: { txHash, network: "testnet", status: "PENDING" },
    });
  });
  const result = await d.execute.conditional.reconcile({ intent: intentId });
  assert.equal(result.data.intent, intentId);
  assert.equal(call.url.searchParams.get("version"), "2");
  assert.deepEqual(JSON.parse(call.init.body), { intent: intentId });
  await assert.rejects(
    setup(async () =>
      response({
        intent: id,
        state: "SUBMITTING",
        transaction: { txHash, network: "testnet", status: "PENDING" },
      }),
    ).execute.conditional.reconcile({ intent: intentId }),
    PaiflowMalformedResponseError,
  );
});
test("conditional signing interruption and timeout preserve the original preparation", async () => {
  const prepared = { data: receipt(), metadata: { status: 200 } };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    signPrepared(prepared, async () => ({ signedXdr: "signed-original" }), {
      walletAddress: original.payer,
      signal: controller.signal,
    }),
    PaiflowAbortError,
  );
  await assert.rejects(
    signPrepared(prepared, async () => new Promise(() => {}), {
      walletAddress: original.payer,
      timeoutMs: 1,
    }),
    PaiflowTimeoutError,
  );
  assert.equal(prepared.data.intent, intentId);
  assert.equal(prepared.data.txHash, txHash);
  assert.equal(prepared.data.xdr, "unsigned-original-envelope");
});
test("public standard-network hash validation covers both networks without runtime crypto dependencies", () => {
  for (const [net, phrase] of Object.entries({
    testnet: passphrase,
    mainnet: "Public Global Stellar Network ; September 2015",
  })) {
    const v = receipt();
    v.network = net;
    v.networkPassphrase = phrase;
    v.execution.networkPassphraseHash = createHash("sha256").update(phrase).digest("hex");
    assert.equal(parseConditionalExecutePrepared(v).network, net);
  }
});

test("public branch preview validates its snapshot and never grants routing authority", () => {
  const result = selectConditionalExecutionBranch(original.definition, original.amountStroops);
  assert.deepEqual(result, {
    selectedBranch: original.selectedBranch,
    amountAtConditionStroops: original.amountAtConditionStroops,
  });
  assert.throws(() =>
    selectConditionalExecutionBranch(
      { ...original.definition, version: 1 },
      original.amountStroops,
    ),
  );
  assert.throws(() => selectConditionalExecutionBranch(original.definition, "01"));
  assert.throws(() => selectConditionalExecutionBranch(original.definition, "1"));
});

test("conditional state and prepare compare uppercase deployment UUID identities without rewriting evidence", async () => {
  const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const discovery = clone(fixtures.discovery);
  discovery.deploymentId = lower;
  const prepared = receipt();
  prepared.execution.deploymentId = lower;
  const calls = [];
  const deployment = new Paiflow({
    baseUrl: "https://example.com",
    token: "pfk_test",
    fetch: async (url) => {
      calls.push(String(url));
      return response(calls.length === 1 ? discovery : prepared);
    },
  }).deployment(lower.toUpperCase());
  assert.equal((await deployment.execute.conditional.state()).data.deploymentId, lower);
  assert.equal(
    (await deployment.execute.conditional.prepare(request(original))).data.execution.deploymentId,
    lower,
  );
  assert.ok(calls.every((url) => url.includes(lower.toUpperCase())));
  const mismatch = clone(prepared);
  mismatch.execution.deploymentId = id;
  assert.throws(() => parseConditionalExecutePrepared(mismatch, request(original), lower));
});

test("conditional reconcile compares uppercase intent UUID identity and retains original request and response spelling", async () => {
  const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  let sent;
  const deployment = setup(async (_url, init) => {
    sent = JSON.parse(init.body);
    return response({
      intent: lower,
      state: "SUBMITTING",
      transaction: { txHash, network: "testnet", status: "PENDING" },
    });
  });
  const result = await deployment.execute.conditional.reconcile({ intent: lower.toUpperCase() });
  assert.deepEqual(sent, { intent: lower.toUpperCase() });
  assert.equal(result.data.intent, lower);
  await assert.rejects(
    setup(async () =>
      response({
        intent: intentId,
        state: "SUBMITTING",
        transaction: { txHash, network: "testnet", status: "PENDING" },
      }),
    ).execute.conditional.reconcile({ intent: lower.toUpperCase() }),
    PaiflowMalformedResponseError,
  );
});
