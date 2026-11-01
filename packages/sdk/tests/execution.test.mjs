import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Paiflow, signPrepared, PaiflowMalformedResponseError } from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const intentId = "22222222-2222-4222-8222-222222222222";
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const root = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const child = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const passphrase = "Test SDF Network ; September 2015";
const args = { version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: wallet }] };
const execution = {
  version: 1,
  deploymentId: id,
  networkPassphraseHash: createHash("sha256").update(passphrase).digest("hex"),
  rootContract: root,
  assetContract: child,
  payer: wallet,
  amountStroops: "9007199254740993",
  nonce: "ab".repeat(32),
  expiresAtLedger: 100,
  nodes: [
    { nodeId: "root", contractAddress: root, expectedRevision: "0" },
    { nodeId: "pay", contractAddress: child, expectedRevision: "0" },
  ],
  arguments: args,
};
const prepared = {
  intent: intentId,
  txHash: "cd".repeat(32),
  walletAddress: wallet,
  xdr: "unsigned-envelope",
  expiresAt: "2099-01-01T00:00:00Z",
  network: "testnet",
  networkPassphrase: passphrase,
  execution,
};
const response = (data) => new Response(JSON.stringify({ data }));
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: `pfd_${"a".repeat(64)}`, fetch }).deployment(
    id,
  );

test("parameterized prepare preserves exact inputs/key/receipt through wallet signing and submit", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(calls.length === 1 ? prepared : { txHash: prepared.txHash, status: "UNKNOWN" });
  });
  const p = await d.execute.prepare(
    { amount: execution.amountStroops, from: wallet, arguments: args },
    { idempotencyKey: "order:123" },
  );
  assert.equal(calls[0].init.headers.get("Idempotency-Key"), "order:123");
  assert.deepEqual(JSON.parse(calls[0].init.body).arguments, args);
  const signed = await signPrepared(p, async () => ({ signedXdr: "signed-envelope" }), {
    walletAddress: wallet,
  });
  assert.equal(signed.submission.intent, intentId);
  const submitted = await d.execute.submit(signed.submission, { wait: false });
  assert.equal(submitted.data.status, "UNKNOWN");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    signedXdr: "signed-envelope",
    intent: intentId,
  });
  assert.equal(calls.length, 2);
});
test("reconcile queries original intent without another prepare/sign/submit", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), init });
    return response({
      intent: intentId,
      state: "SUBMITTING",
      transaction: { txHash: prepared.txHash, network: "testnet", status: "UNKNOWN" },
    });
  });
  const result = await d.execute.reconcile({ intent: intentId });
  assert.equal(result.data.transaction.status, "UNKNOWN");
  assert.match(calls[0].url, /execute\/reconcile$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { intent: intentId });
  assert.equal(calls.length, 1);
});
for (const bad of [
  { version: 2, inputs: [] },
  { version: 1, inputs: [{ ...args.inputs[0], amountStroops: "1" }] },
  { version: 1, inputs: [{ kind: "pay", nodeId: "pay" }] },
  { version: 1, inputs: [args.inputs[0], args.inputs[0]] },
  {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [{ rowId: "row", allocation: { kind: "fixed", amountStroops: "01" } }],
      },
    ],
  },
  {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [{ rowId: "row", allocation: { kind: "fixed", amountStroops: 1 } }],
      },
    ],
  },
  {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [{ rowId: "row", recipient: wallet }],
        additionalRecipients: [
          { rowId: "row", recipient: wallet, allocation: { kind: "percentage", bps: 10000 } },
        ],
      },
    ],
  },
])
  test(`SDK rejects malformed execution inputs before HTTP: ${JSON.stringify(bad)}`, () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return response(prepared);
    });
    assert.throws(
      () => d.execute.prepare({ amount: "1", from: wallet, arguments: bad }),
      TypeError,
    );
    assert.equal(calls, 0);
  });
test("legacy discovery explicitly reports unsupported without inventing runtime metadata", async () => {
  const d = setup(async () =>
    response({
      supported: false,
      policyVersion: 0,
      deploymentId: id,
      network: "testnet",
      reason: "Legacy deployment",
    }),
  );
  assert.equal((await d.execute.state()).data.supported, false);
});
test("incomplete preparation evidence and inconsistent payer are malformed responses", async () => {
  for (const bad of [
    { ...prepared, intent: undefined },
    { ...prepared, execution: { ...execution, payer: "invalid" } },
  ]) {
    const d = setup(async () => response(bad));
    await assert.rejects(
      d.execute.prepare({ amount: "1", from: wallet, arguments: args }),
      PaiflowMalformedResponseError,
    );
  }
});
