import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  Paiflow,
  signPrepared,
  PaiflowMalformedResponseError,
  PaiflowApiError,
  parseConditionalMutationArguments,
  parseConditionalMutationIntent,
  parseConditionalMutationState,
  parseConditionalMutationPrepared,
  parseConditionalConfigurationHistory,
  parseConditionalPreparationRefusal,
} from "../dist/index.js";
const { scenarios } = JSON.parse(
  await readFile(new URL("./fixtures/conditional-mutation.json", import.meta.url), "utf8"),
);
const clone = structuredClone,
  original = scenarios[0].mutation,
  id = original.deploymentId,
  intentId = "abcdefab-cdef-4abc-8def-abcdefabcdef",
  txHash = "ab".repeat(32),
  phrase = "Test SDF Network ; September 2015";
const request = (m) => ({ admin: m.admin, arguments: clone(m.arguments) });
const receipt = (mutation = original) => ({
  intent: intentId,
  txHash,
  walletAddress: mutation.admin,
  xdr: "original-unsigned-envelope",
  expiresAt: "2099-01-01T00:00:00.000Z",
  network: "testnet",
  networkPassphrase: phrase,
  feeStroops: "100",
  mutation: clone(mutation),
});
const history = () => ({
  version: 2,
  deploymentId: id,
  network: "testnet",
  coverage: "observed-revisions-only",
  historyComplete: false,
  revisionCoverage: scenarios[0].state.statuses.map(({ state }) => ({
    nodeId: state.nodeId,
    highestObservedRevision: "0",
    observedRevisionCount: "1",
    missingRevisionCount: "0",
  })),
  items: scenarios[0].state.statuses.map(({ state }, i) => ({
    id: `abcdefab-cdef-4abc-8def-${String(i).padStart(12, "0")}`,
    configuration: clone(state),
    observedLedger: 100,
    eventLedger: null,
    eventId: null,
    txHash: null,
  })),
  nextCursor: null,
});
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const client = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id)
    .configuration.conditional;
for (const s of scenarios)
  test(`strict production fixture ${s.name}`, () => {
    assert.deepEqual(parseConditionalMutationIntent(s.mutation), s.mutation);
    assert.deepEqual(parseConditionalMutationState(s.state), s.state);
    assert.deepEqual(parseConditionalMutationPrepared(receipt(s.mutation)), receipt(s.mutation));
  });
for (const threshold of ["0", ((1n << 127n) - 1n).toString()])
  test(`mutable threshold boundary ${threshold}`, () => {
    const m = clone(original);
    m.arguments.changes[1].thresholdStroops = threshold;
    assert.equal(
      parseConditionalMutationIntent(m).arguments.changes[1].thresholdStroops,
      threshold,
    );
  });
for (const [name, mutate] of [
  ["v1 envelope", (m) => (m.version = 1)],
  ["v1 arguments", (m) => (m.arguments.version = 1)],
  ["unknown intent metadata", (m) => (m.contact = "private")],
  ["definition private metadata", (m) => (m.definition.privateContact = "private")],
  [
    "wrong admin",
    (m) => (m.admin = m.definition.trueBranch.configuration.configuredRows[0].recipient),
  ],
  ["wrong root", (m) => (m.rootContract = m.nodes[1].contractAddress)],
  ["missing inactive binding", (m) => m.nodes.pop()],
  ["bad hash", (m) => (m.nodes.at(-1).wasmHash = "ab")],
  ["duplicate contract", (m) => (m.nodes.at(-1).contractAddress = m.nodes[0].contractAddress)],
  ["root revision", (m) => (m.nodes[0].expectedRevision = "1")],
  ["empty changes", (m) => (m.arguments.changes = [])],
  ["duplicate change", (m) => m.arguments.changes.push(clone(m.arguments.changes[0]))],
  ["unordered change", (m) => m.arguments.changes.reverse()],
  ["root change", (m) => (m.arguments.changes[0].nodeId = "receive")],
  ["wrong kind", (m) => (m.arguments.changes[0].kind = "split")],
  ["stale revision", (m) => (m.arguments.changes[0].expectedRevision = "1")],
  ["revision overflow", (m) => (m.arguments.changes[0].expectedRevision = (1n << 64n).toString())],
  [
    "revision exhausted",
    (m) => {
      m.nodes[1].expectedRevision = ((1n << 64n) - 1n).toString();
      m.arguments.changes[0].expectedRevision = m.nodes[1].expectedRevision;
    },
  ],
  ["constant threshold", (m) => (m.definition.condition.thresholdMode = "constant")],
  ["threshold no-op", (m) => (m.arguments.changes[1].thresholdStroops = "50")],
  ["negative threshold", (m) => (m.arguments.changes[1].thresholdStroops = "-1")],
  [
    "threshold overflow",
    (m) => (m.arguments.changes[1].thresholdStroops = (1n << 127n).toString()),
  ],
  ["threshold leading zero", (m) => (m.arguments.changes[1].thresholdStroops = "00")],
  ["execution threshold", (m) => (m.definition.condition.thresholdMode = "execution")],
  ["constant pay", (m) => (m.definition.prefix[0].policy.payoutValue = "constant")],
  ["execution pay", (m) => (m.definition.prefix[0].policy.payoutValue = "execution")],
  ["pay no-op", (m) => (m.arguments.changes[0].payoutValue.amountStroops = "10")],
  [
    "pay mode change",
    (m) => (m.arguments.changes[0].payoutValue = { kind: "percentage", bps: 100 }),
  ],
  ["full prefix", (m) => (m.arguments.changes[0].payoutValue = { kind: "full" })],
  ["constant row recipient", (m) => (m.arguments.changes[3].rows[1].recipient = m.admin)],
  ["unknown row", (m) => (m.arguments.changes[2].rows[0].rowId = "unknown")],
  ["duplicate row", (m) => m.arguments.changes[2].rows.push(clone(m.arguments.changes[2].rows[0]))],
  ["immutable roster", (m) => (m.definition.trueBranch.policy.additionalRecipients = "constant")],
  ["unknown allocation metadata", (m) => (m.arguments.changes[0].payoutValue.contact = "private")],
  [
    "split duplicate recipient",
    (m) =>
      (m.arguments.changes[3].rows[0].recipient =
        m.definition.falseBranch.configuration.configuredRows[1].recipient),
  ],
  [
    "split sum overflow",
    (m) =>
      (m.arguments.changes[2].rows[0].allocation.amountStroops = ((1n << 127n) - 1n).toString()),
  ],
  ["unknown change field", (m) => (m.arguments.changes[1].comparison = "amount_lt")],
])
  test(`reject intent ${name}`, () => {
    const m = clone(original);
    mutate(m);
    assert.throws(() => parseConditionalMutationIntent(m));
  });
for (const [name, mutate] of [
  ["outer version", (p) => (p.version = 2)],
  [
    "wallet",
    (p) =>
      (p.walletAddress =
        p.mutation.definition.trueBranch.configuration.configuredRows[0].recipient),
  ],
  ["network", (p) => (p.network = "mainnet")],
  ["passphrase", (p) => (p.networkPassphrase = "caller supplied")],
  ["network hash", (p) => (p.mutation.networkPassphraseHash = "00".repeat(32))],
  ["fee zero", (p) => (p.feeStroops = "0")],
  ["fee leading zero", (p) => (p.feeStroops = "01")],
  ["short envelope", (p) => (p.xdr = "short")],
  ["unknown receipt metadata", (p) => (p.privateContact = "private")],
])
  test(`reject receipt ${name}`, () => {
    const p = receipt();
    mutate(p);
    assert.throws(() => parseConditionalMutationPrepared(p));
  });
test("public network hashes derive from standard passphrases", () => {
  const p = receipt();
  assert.equal(createHash("sha256").update(phrase).digest("hex"), p.mutation.networkPassphraseHash);
  p.network = "mainnet";
  p.networkPassphrase = "Public Global Stellar Network ; September 2015";
  p.mutation.networkPassphraseHash = createHash("sha256").update(p.networkPassphrase).digest("hex");
  assert.deepEqual(parseConditionalMutationPrepared(p), p);
});
test("complete baseline history and exact observed gaps", () => {
  const h = history();
  assert.deepEqual(parseConditionalConfigurationHistory(h), h);
  h.items[1].configuration.revision = "5";
  Object.assign(h.revisionCoverage[1], {
    highestObservedRevision: "5",
    observedRevisionCount: "2",
    missingRevisionCount: "4",
  });
  assert.deepEqual(parseConditionalConfigurationHistory(h), h);
});
for (const [name, mutate] of [
  ["v1", (h) => (h.version = 1)],
  ["complete claim", (h) => (h.historyComplete = true)],
  ["duplicate coverage", (h) => h.revisionCoverage.push(clone(h.revisionCoverage[0]))],
  ["duplicate item", (h) => h.items.push(clone(h.items[0]))],
  ["excess observations", (h) => (h.revisionCoverage[0].observedRevisionCount = "2")],
  ["false missing count", (h) => (h.revisionCoverage[0].missingRevisionCount = "1")],
  ["missing coverage", (h) => h.revisionCoverage.shift()],
  ["revision above coverage", (h) => (h.items[1].configuration.revision = "1")],
  [
    "immutable baseline revision",
    (h) => {
      h.items[0].configuration.revision = "1";
      Object.assign(h.revisionCoverage[0], {
        highestObservedRevision: "1",
        missingRevisionCount: "1",
      });
    },
  ],
  ["unknown state ledger", (h) => (h.items[0].configuration.confirmedLedger = 100)],
  ["configuration ID mismatch", (h) => (h.items[1].configuration.configuration.nodeId = "other")],
  [
    "self parent",
    (h) => (h.items[1].configuration.parentContract = h.items[1].configuration.contractAddress),
  ],
  [
    "root parent",
    (h) => (h.items[0].configuration.parentContract = h.items[1].configuration.contractAddress),
  ],
  ["condition incomplete successors", (h) => h.items[2].configuration.nextContracts.pop()],
  [
    "terminal forwarding",
    (h) => (h.items[3].configuration.nextContracts = [h.items[0].configuration.contractAddress]),
  ],
  ["private metadata", (h) => (h.items[0].configuration.privateContact = "private")],
  ["noncanonical count", (h) => (h.revisionCoverage[0].missingRevisionCount = "00")],
])
  test(`reject history ${name}`, () => {
    const h = history();
    mutate(h);
    assert.throws(() => parseConditionalConfigurationHistory(h));
  });
const proof = () => ({
  version: 2,
  outcome: "NOT_ADMITTED",
  refusalId: intentId,
  deploymentId: id,
  network: "testnet",
  admin: original.admin,
  idempotencyKeyHash: "ab".repeat(32),
  requestDigest: "cd".repeat(32),
  refusedAt: "2026-11-14T00:00:00.000Z",
  reasonCode: "CONFLICT",
});
test("literal v2 refusal proof is separate from uncertainty", () =>
  assert.deepEqual(parseConditionalPreparationRefusal(proof()), proof()));
for (const [name, mutate] of [
  ["v1", (p) => (p.version = 1)],
  ["unknown outcome", (p) => (p.outcome = "UNKNOWN")],
  ["missing request digest", (p) => delete p.requestDigest],
  ["bad refusal UUID", (p) => (p.refusalId = "bad")],
  ["private fields", (p) => (p.signedXdr = "secret")],
  ["unsupported reason", (p) => (p.reasonCode = "INTERNAL")],
])
  test(`reject refusal ${name}`, () => {
    const p = proof();
    mutate(p);
    assert.throws(() => parseConditionalPreparationRefusal(p));
  });
test("five operations pin version 2 and retain original recovery identity", async () => {
  const calls = [],
    d = client(async (url, init) => {
      calls.push({ url: new URL(url), init });
      return response(
        [
          scenarios[0].state,
          history(),
          receipt(),
          { txHash, network: "testnet", status: "UNKNOWN" },
          {
            intent: intentId,
            state: "SUBMITTING",
            transaction: { txHash, network: "testnet", status: "UNKNOWN" },
          },
        ][calls.length - 1],
        { "x-history-request-id": intentId },
      );
    });
  await d.get();
  await d.history({ limit: 10 });
  const p = await d.prepare(request(original), { idempotencyKey: "original:key" });
  const signed = await signPrepared(
    p,
    async (context) => {
      assert.equal(context.xdr, p.data.xdr);
      return { signedXdr: "original-signed-envelope" };
    },
    { walletAddress: original.admin, expectedNetwork: "testnet" },
  );
  assert.equal(signed.preparation, p);
  await d.submit(signed.submission, signed.submissionOptions);
  await d.reconcile({ intent: intentId.toUpperCase() });
  assert.equal(calls.length, 5);
  for (const call of calls) assert.equal(call.url.searchParams.get("version"), "2");
  assert.equal(calls[2].init.headers.get("Idempotency-Key"), "original:key");
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    intent: intentId,
    signedXdr: "original-signed-envelope",
  });
  assert.equal(calls[3].init.headers.get("x-preparation-request-id"), intentId);
});
test("uppercase deployment UUID compares identity without rewriting evidence", async () => {
  const upper = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
    lower = upper.toLowerCase(),
    s = clone(scenarios[0].state),
    h = history(),
    p = receipt();
  s.deploymentId = lower;
  h.deploymentId = lower;
  p.mutation.deploymentId = lower;
  let count = 0;
  const d = new Paiflow({
    baseUrl: "https://example.com",
    token: "pfk_test",
    fetch: async () => response([s, p, h][count++]),
  }).deployment(upper).configuration.conditional;
  assert.equal((await d.get()).data.deploymentId, lower);
  assert.equal(
    (await d.prepare(request(original), { idempotencyKey: "key" })).data.mutation.deploymentId,
    lower,
  );
  assert.equal((await d.history()).data.deploymentId, lower);
});
for (const [name, mutate] of [
  ["deployment", (p) => (p.mutation.deploymentId = intentId)],
  [
    "request admin",
    (p) => {
      p.mutation.admin =
        p.mutation.definition.owner =
        p.walletAddress =
          p.mutation.definition.trueBranch.configuration.configuredRows[0].recipient;
    },
  ],
  ["request changes", (p) => (p.mutation.arguments.changes[1].thresholdStroops = "201")],
])
  test(`prepare response rejects ${name} mismatch`, async () => {
    const p = receipt();
    mutate(p);
    await assert.rejects(
      client(async () => response(p)).prepare(request(original), { idempotencyKey: "key" }),
      PaiflowMalformedResponseError,
    );
  });
test("reconcile rejects another original intent", async () =>
  await assert.rejects(
    client(async () =>
      response({
        intent: id,
        state: "PREPARED",
        transaction: { txHash, network: "testnet", status: "PENDING" },
      }),
    ).reconcile({ intent: intentId }),
    PaiflowMalformedResponseError,
  ));
test("lost preparation response requires explicit retry with same key/body", async () => {
  let calls = 0;
  const d = client(async () => {
    calls++;
    throw new TypeError("lost");
  });
  await assert.rejects(d.prepare(request(original), { idempotencyKey: "same" }));
  assert.equal(calls, 1);
});
test("prepare requires key and explicit v2, query rejects caller selector", () => {
  const d = client(async () => {
    throw new Error("must not fetch");
  });
  assert.throws(() => d.prepare(request(original)), TypeError);
  assert.throws(
    () =>
      d.prepare(
        { ...request(original), arguments: { version: 1, changes: original.arguments.changes } },
        { idempotencyKey: "key" },
      ),
    TypeError,
  );
  assert.throws(() => d.history({ version: 1 }), TypeError);
});
test("durable v2 refusal survives API field transport without automatic retry", async () => {
  let calls = 0;
  const d = client(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: "CONFLICT",
          message: "durably refused",
          fields: { preparationRefusal: [JSON.stringify(proof())] },
        },
      }),
      { status: 409 },
    );
  });
  await assert.rejects(d.prepare(request(original), { idempotencyKey: "key" }), (e) => {
    assert.ok(e instanceof PaiflowApiError);
    assert.deepEqual(
      parseConditionalPreparationRefusal(JSON.parse(e.fields.preparationRefusal[0])),
      proof(),
    );
    return true;
  });
  assert.equal(calls, 1);
});
for (const [name, mutate] of [
  ["admin", (s) => (s.admin = s.definition.trueBranch.configuration.configuredRows[0].recipient)],
  ["capability", (s) => (s.mutationSupported = false)],
  ["inactive obligation on nonholding", (s) => (s.statuses[2].obligationsStroops = "1")],
  ["inactive revision", (s) => (s.statuses.at(-1).state.revision = "1")],
  ["swapped route", (s) => s.statuses[2].state.nextContracts.reverse()],
  ["unsupported", (s) => (s.supported = false)],
  ["unknown field", (s) => (s.privateContact = "private")],
])
  test(`reject current state ${name}`, () => {
    const s = clone(scenarios[0].state);
    mutate(s);
    assert.throws(() => parseConditionalMutationState(s));
  });
test("state retains inactive accounted debt with zero raw-token assumptions absent", () => {
  const s = clone(scenarios[0].state);
  s.statuses.at(-1).obligationsStroops = "1";
  assert.equal(parseConditionalMutationState(s).statuses.at(-1).obligationsStroops, "1");
});
test("history includes immutable Return baseline and rejects forged owner or revision", async () => {
  const old = JSON.parse(
    await readFile(new URL("./fixtures/conditional-execution.json", import.meta.url), "utf8"),
  );
  const state = old.discovery.statuses.find(
    (s) => s.state.configuration.kind === "return_to_owner",
  ).state;
  const h = history();
  h.revisionCoverage = h.revisionCoverage.filter((r) => r.nodeId !== state.nodeId);
  h.items = h.items.filter((item) => item.configuration.nodeId !== state.nodeId);
  h.revisionCoverage.push({
    nodeId: state.nodeId,
    highestObservedRevision: "0",
    observedRevisionCount: "1",
    missingRevisionCount: "0",
  });
  h.items.push({
    id: "abcdefab-cdef-4abc-8def-999999999999",
    configuration: state,
    observedLedger: 100,
    eventLedger: null,
    eventId: null,
    txHash: null,
  });
  assert.equal(
    parseConditionalConfigurationHistory(h).items.at(-1).configuration.configuration.recipient,
    state.admin,
  );
  const altered = clone(h);
  altered.items.at(-1).configuration.configuration.recipient =
    original.definition.trueBranch.configuration.configuredRows[0].recipient;
  assert.throws(() => parseConditionalConfigurationHistory(altered));
});
