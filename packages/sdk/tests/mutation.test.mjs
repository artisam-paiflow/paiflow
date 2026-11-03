import assert from "node:assert/strict";
import { test } from "node:test";
import { Paiflow, PaiflowMalformedResponseError, PaiflowApiError } from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111",
  intentId = "22222222-2222-4222-8222-222222222222";
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  root = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  child = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const args = {
  version: 1,
  changes: [
    {
      kind: "pay",
      nodeId: "pay",
      expectedRevision: "0",
      payoutValue: { kind: "fixed", amountStroops: "9007199254740993" },
    },
  ],
};
const mutation = {
  version: 1,
  deploymentId: id,
  network: "testnet",
  admin: wallet,
  rootContract: root,
  nodes: [
    { nodeId: "root", contractAddress: root, expectedRevision: "0" },
    { nodeId: "pay", contractAddress: child, expectedRevision: "0" },
  ],
  arguments: args,
  artifacts: [
    { nodeId: "root", contractAddress: root, wasmHash: "a".repeat(64) },
    { nodeId: "pay", contractAddress: child, wasmHash: "b".repeat(64) },
  ],
};
const prepared = {
  intent: intentId,
  txHash: "c".repeat(64),
  walletAddress: wallet,
  xdr: "unsigned-mutation-envelope",
  expiresAt: "2099-01-01T00:00:00Z",
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  feeStroops: "1000",
  mutation,
};
const response = (data) => Response.json({ data });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: `pfd_${"a".repeat(64)}`, fetch }).deployment(
    id,
  ).configuration;
test("mutation prepare/sign/submit preserves exact original key/revisions/large money and admin signing", async () => {
  const calls = [];
  const client = setup(async (url, init) => {
    calls.push({ url, init });
    return response(
      calls.length === 1
        ? prepared
        : { txHash: prepared.txHash, network: "testnet", status: "UNKNOWN" },
    );
  });
  const p = await client.prepare(
    { admin: wallet, arguments: args },
    { idempotencyKey: "update:1" },
  );
  assert.equal(calls[0].init.headers.get("Idempotency-Key"), "update:1");
  assert.deepEqual(JSON.parse(calls[0].init.body), { admin: wallet, arguments: args });
  let signed = 0;
  const signing = await client.signPrepared(
    p,
    async (wire) => {
      signed++;
      assert.equal(wire.walletAddress, wallet);
      return { signedXdr: "signed-envelope" };
    },
    { walletAddress: wallet },
  );
  assert.equal(signed, 1);
  assert.equal(signing.submission.intent, intentId);
  assert.equal(calls.length, 1);
  const result = await client.submit(signing.submission, signing.submissionOptions);
  assert.equal(result.data.status, "UNKNOWN");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    intent: intentId,
    signedXdr: "signed-envelope",
  });
});
test("mutation requires explicit idempotency key before network and rejects unknown fields", () => {
  let calls = 0;
  const client = setup(async () => {
    calls++;
    return response(prepared);
  });
  assert.throws(() => client.prepare({ admin: wallet, arguments: args }), TypeError);
  assert.throws(
    () =>
      client.prepare(
        { admin: wallet, arguments: args, network: "mainnet" },
        { idempotencyKey: "x" },
      ),
    TypeError,
  );
  assert.throws(
    () =>
      client.prepare(
        {
          admin: wallet,
          arguments: {
            version: 1,
            changes: [{ kind: "schedule", nodeId: "pay", expectedRevision: "0" }],
          },
        },
        { idempotencyKey: "x" },
      ),
    TypeError,
  );
  assert.equal(calls, 0);
});
for (const change of [
  { mutation: { ...mutation, deploymentId: "33333333-3333-4333-8333-333333333333" } },
  { network: "mainnet" },
  { mutation: { ...mutation, nodes: mutation.nodes.toReversed() } },
  {
    mutation: {
      ...mutation,
      arguments: { version: 1, changes: [{ ...args.changes[0], expectedRevision: "1" }] },
    },
  },
  {
    mutation: {
      ...mutation,
      arguments: {
        version: 1,
        changes: [{ ...args.changes[0], payoutValue: { kind: "fixed", amountStroops: "2" } }],
      },
    },
  },
])
  test("mutation refuses mismatched preparation identity/network/revisions/terms", async () => {
    const client = setup(async () => response({ ...prepared, ...change }));
    await assert.rejects(
      () => client.prepare({ admin: wallet, arguments: args }, { idempotencyKey: "x" }),
      PaiflowMalformedResponseError,
    );
  });
test("reconciliation queries only original intent and does not resubmit after UNKNOWN", async () => {
  const calls = [];
  const client = setup(async (url, init) => {
    calls.push({ url, init });
    return response({
      intent: intentId,
      state: "SUBMITTING",
      transaction: { txHash: prepared.txHash, network: "testnet", status: "UNKNOWN" },
    });
  });
  const result = await client.reconcile({ intent: intentId });
  assert.equal(result.data.state, "SUBMITTING");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url.pathname, /configuration\/reconcile$/);
});
test("history exposes gaps and refuses foreign response/cursor data", async () => {
  const client = setup(async () =>
    response({
      deploymentId: "33333333-3333-4333-8333-333333333333",
      network: "testnet",
      coverage: "observed-revisions-only",
      historyComplete: false,
      revisionCoverage: [],
      items: [],
      nextCursor: null,
    }),
  );
  await assert.rejects(() => client.history(), PaiflowMalformedResponseError);
});
test("refused preparation preserves existing status, useful fields and additive non-admission evidence without retry", async () => {
  const proof = {
    version: 1,
    outcome: "NOT_ADMITTED",
    refusalId: intentId,
    deploymentId: id,
    network: "testnet",
    admin: wallet,
    idempotencyKeyHash: "a".repeat(64),
    requestDigest: "b".repeat(64),
    refusedAt: "2026-11-01T13:00:00.000Z",
    reasonCode: "VALIDATION",
  };
  const fields = {
    arguments: ["Reviewed allocation was refused"],
    preparationRefusal: [JSON.stringify(proof)],
  };
  let calls = 0;
  const client = setup(async () => {
    calls++;
    return Response.json(
      { error: { code: "VALIDATION", message: "Review the proposed allocation", fields } },
      { status: 422 },
    );
  });
  await assert.rejects(
    () =>
      client.prepare(
        { admin: wallet, arguments: args },
        { idempotencyKey: "original-refused-key" },
      ),
    (error) => {
      assert.ok(error instanceof PaiflowApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "VALIDATION");
      assert.deepEqual(error.fields, fields);
      return true;
    },
  );
  assert.equal(calls, 1);
});
