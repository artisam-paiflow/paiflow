import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  Paiflow,
  PaiflowApiError,
  PaiflowMalformedResponseError,
  PaiflowSigningError,
  PaiflowTimeoutError,
  PaiflowAbortError,
} from "../dist/index.js";
// Wire fixtures follow funding-schema.ts and funding/{submit,reconcile}/route.ts.
const id = "11111111-1111-4111-8111-111111111111",
  txHash = "a".repeat(64);
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const passphrase = "Test SDF Network ; September 2015";
const input = {
  nodeId: "schedule",
  fromAddress: wallet,
  tokenContractAddress: contract,
  amountStroops: "9007199254740993",
};
const prepared = {
  ...input,
  intent: id,
  txHash,
  expiresAt: "2099-01-01T00:00:00Z",
  xdr: "unsigned-envelope",
  action: "schedule.fund",
  network: "testnet",
  networkPassphrase: passphrase,
};
const node = {
  nodeId: "schedule",
  templateKind: "STREAMER",
  contractAddress: contract,
  action: "schedule.fund",
  tokenContractAddress: contract,
  authorization: "funding_wallet",
  effect: "Adds funds only; does not execute a payout or Webhook callback",
};
const discovery = { deploymentId: id, network: "testnet", nodes: [node] };
const reconciled = {
  intent: id,
  action: "schedule.fund",
  txHash,
  network: "testnet",
  state: "PREPARED",
  expiresAt: "2000-01-01T00:00:00Z",
};
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const artifact = (data = prepared) => ({ data, metadata: { status: 200, historyRequestId: id } });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id);
for (const kind of ["schedule", "webhook"])
  test(`${kind} complete explicit discover/prepare/sign/submit/status/reconcile sequence`, async () => {
    const calls = [];
    const action = `${kind}.fund`;
    const p = { ...prepared, action };
    const d = setup(async (url, init) => {
      calls.push({ url: String(url), init });
      switch (calls.length) {
        case 1:
          return response({
            ...discovery,
            nodes: [
              { ...node, action, templateKind: kind === "schedule" ? "STREAMER" : "WEBHOOK" },
            ],
          });
        case 2:
          return response(p, { "x-history-request-id": id });
        case 3:
          return response({ txHash, network: "testnet", status: "PENDING" });
        case 4:
          return response({ txHash, network: "testnet", status: "SUCCESS", ledger: 123 });
        default:
          return response({ ...reconciled, action, state: "SUCCESS" });
      }
    });
    assert.equal((await d.funding.get()).data.nodes[0].authorization, "funding_wallet");
    const original = await d.funding.prepare({ ...input, secretKey: "do-not-forward" });
    let signs = 0;
    const s = await d.funding.signPrepared(
      original,
      async (request) => {
        signs++;
        assert.equal(request.xdr, p.xdr);
        assert.equal(request.networkPassphrase, passphrase);
        assert.equal(request.walletAddress, wallet);
        return { signedXdr: "s" };
      },
      { walletAddress: wallet, expectedNetwork: "testnet" },
    );
    assert.equal(calls.length, 2);
    assert.equal(signs, 1);
    assert.equal(s.preparation, original);
    assert.equal(s.preparation.data.txHash, txHash);
    assert.deepEqual(s.submission, { action, intent: id, signedXdr: "s" });
    assert.equal(
      (
        await d.funding.submit(
          { ...s.submission, amountStroops: "123", secretKey: "do-not-forward" },
          s.submissionOptions,
        )
      ).data.status,
      "PENDING",
    );
    assert.equal((await d.transactions.get(txHash)).data.status, "SUCCESS");
    assert.equal((await d.funding.reconcile(s.submission)).data.state, "SUCCESS");
    assert.equal(calls.length, 5);
    assert.deepEqual(JSON.parse(calls[1].init.body), input);
    assert.deepEqual(JSON.parse(calls[2].init.body), s.submission);
    assert.deepEqual(JSON.parse(calls[4].init.body), { action, intent: id });
    assert.equal(calls[2].init.headers.get("x-preparation-request-id"), id);
    for (const call of calls) {
      assert.equal(call.init.headers.get("authorization"), "Bearer pfk_test");
      assert.ok(!/webhooks|execute|trigger|payout/.test(call.url));
    }
  });
for (const state of ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"])
  test(`reconciliation ${state} stays source-shaped; wall-clock expiry never implies replacement`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return response({ ...reconciled, state, replacementAllowed: true, additive: "future" });
    });
    const result = await d.funding.reconcile({ action: "schedule.fund", intent: id });
    assert.equal(result.data.state, state);
    assert.equal(result.data.expiresAt, reconciled.expiresAt);
    assert.equal("replacementAllowed" in result.data, false);
    assert.equal(calls, 1);
  });
test("submission preserves UNKNOWN/REJECTED/FAILED with network, ledger and errors", async () => {
  for (const status of ["UNKNOWN", "REJECTED", "FAILED", "SUCCESS", "PENDING"]) {
    const wire = {
      txHash,
      network: "testnet",
      status,
      ledger: 123,
      error: { code: "RPC_REJECTED", message: "no finality" },
    };
    const d = setup(async () => response(wire));
    assert.deepEqual(
      (await d.funding.submit({ action: "webhook.fund", intent: id, signedXdr: "s" })).data,
      wire,
    );
  }
});
test("conflict preserves existing intent/hash for explicit recovery without hidden calls", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: "CONFLICT",
          message: "Reconcile original",
          fields: { intent: id, txHash, nodeId: "schedule" },
        },
      }),
      { status: 409, headers: { "x-history-request-id": id } },
    );
  });
  await assert.rejects(d.funding.prepare(input), (e) => {
    assert.ok(e instanceof PaiflowApiError);
    assert.deepEqual(e.fields, { intent: id, txHash, nodeId: "schedule" });
    assert.equal(e.metadata.historyRequestId, id);
    return true;
  });
  assert.equal(calls, 1);
});
test("uncertain submit and missing RPC history keep original receipt, no automatic retries", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), body: init.body });
    return new Response(
      JSON.stringify({ error: { code: "UPSTREAM_RPC", message: "History unavailable" } }),
      { status: 502 },
    );
  });
  const body = { action: "schedule.fund", intent: id, signedXdr: "s" };
  await assert.rejects(d.funding.submit(body), PaiflowApiError);
  assert.equal(calls.length, 1);
  await assert.rejects(d.funding.reconcile(body), PaiflowApiError);
  assert.equal(calls.length, 2);
  await assert.rejects(d.funding.submit(body), PaiflowApiError);
  assert.equal(calls[0].body, calls[2].body);
  assert.ok(calls.every((call) => /funding\/(submit|reconcile)$/.test(call.url)));
});
test("unsupported nodes, unreadable asset and wrong authorization errors propagate once", async () => {
  for (const [status, code] of [
    [422, "VALIDATION"],
    [502, "UPSTREAM_RPC"],
    [401, "UNAUTHENTICATED"],
  ]) {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code, message: "unavailable" } }), { status });
    });
    await assert.rejects(d.funding.get(), (e) => e instanceof PaiflowApiError && e.code === code);
    assert.equal(calls, 1);
  }
});
test("prepare input exact positive decimal/i128/address/node constraints before fetch", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response(prepared);
  });
  for (const amountStroops of [
    1,
    "0",
    "00",
    "01",
    "1.2",
    "-1",
    "1e7",
    (1n << 127n).toString(),
    "9".repeat(40),
  ])
    assert.throws(() => d.funding.prepare({ ...input, amountStroops }), TypeError);
  for (const fromAddress of [contract, "secret", wallet.slice(0, -1) + "A"])
    assert.throws(() => d.funding.prepare({ ...input, fromAddress }), TypeError);
  for (const tokenContractAddress of [wallet, "C" + "A".repeat(55)])
    assert.throws(() => d.funding.prepare({ ...input, tokenContractAddress }), TypeError);
  for (const nodeId of ["", "n".repeat(129), 123])
    assert.throws(() => d.funding.prepare({ ...input, nodeId }), TypeError);
  assert.equal(calls, 0);
  await d.funding.prepare({
    ...input,
    nodeId: undefined,
    amountStroops: ((1n << 127n) - 1n).toString(),
  });
  assert.equal(calls, 1);
});
test("funding signed XDR 1..100000; rejects action/intent before fetch", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response({ txHash, network: "testnet", status: "PENDING" });
  });
  for (const signedXdr of ["", "s".repeat(100001), 123, null])
    assert.throws(
      () => d.funding.submit({ action: "schedule.fund", intent: id, signedXdr }),
      TypeError,
    );
  for (const action of ["schedule.pause", "WEBHOOK", "", null])
    assert.throws(() => d.funding.reconcile({ action, intent: id }), TypeError);
  assert.throws(
    () => d.funding.reconcile({ action: "schedule.fund", intent: "opaque-token" }),
    TypeError,
  );
  assert.equal(calls, 0);
  for (const signedXdr of ["s", "s".repeat(100000)])
    await d.funding.submit({ action: "schedule.fund", intent: id, signedXdr });
  assert.equal(calls, 2);
});
test("malformed discovery/prepared/reconciled responses reject; no guessed asset or finality", async () => {
  const invalidDiscovery = [
    { ...discovery, nodes: [{ ...node, tokenContractAddress: wallet }] },
    { ...discovery, nodes: [{ ...node, templateKind: "STREAMER_DEV" }] },
    { ...discovery, nodes: [{ ...node, authorization: "deployment_token" }] },
    { ...discovery, nodes: Array(17).fill(node) },
  ];
  for (const data of invalidDiscovery)
    await assert.rejects(
      setup(async () => response(data)).funding.get(),
      PaiflowMalformedResponseError,
    );
  for (const data of [
    { ...prepared, amountStroops: 123 },
    { ...prepared, intent: "bad" },
    { ...prepared, txHash: "bad" },
    { ...prepared, network: "mainnet" },
    { ...prepared, fromAddress: contract },
    { ...prepared, nodeId: "" },
    { ...prepared, xdr: "" },
    { ...prepared, expiresAt: "2099-02-30T00:00:00Z" },
  ])
    await assert.rejects(
      setup(async () => response(data)).funding.prepare(input),
      PaiflowMalformedResponseError,
    );
  for (const state of ["UNKNOWN", "REJECTED", "EXPIRED_BY_CLOCK"])
    await assert.rejects(
      setup(async () => response({ ...reconciled, state })).funding.reconcile({
        action: "schedule.fund",
        intent: id,
      }),
      PaiflowMalformedResponseError,
    );
});
test("sign checks funder/server wallet, network, and artifact before callback without mutation", async () => {
  let calls = 0;
  const d = setup(async () => {
    throw new Error("no request");
  });
  const signer = async () => {
    calls++;
    return { signedXdr: "s" };
  };
  for (const data of [
    { ...prepared, fromAddress: contract },
    { ...prepared, fromAddress: "GDMFZ5QQMDSOTPEQ6YCAWPFAB626Q6C3KLRLYMO3VWMWHQHL4L2DSIHY" },
    { ...prepared, walletAddress: "other" },
    { ...prepared, network: "mainnet" },
    { ...prepared, action: "schedule.pause" },
    { ...prepared, expiresAt: "2000-01-01T00:00:00Z" },
  ])
    await assert.rejects(
      d.funding.signPrepared(artifact(data), signer, { walletAddress: wallet }),
      TypeError,
    );
  await assert.rejects(
    d.funding.signPrepared(artifact(), signer, {
      walletAddress: wallet,
      expectedNetwork: "mainnet",
    }),
    TypeError,
  );
  assert.equal(calls, 0);
  const p = artifact();
  const before = JSON.stringify(p);
  const signed = await d.funding.signPrepared(p, signer, { walletAddress: wallet });
  assert.equal(JSON.stringify(p), before);
  assert.equal(signed.preparation, p);
  assert.equal(calls, 1);
});
test("sign validates funding-specific envelope bounds and sanitizes wallet rejection", async () => {
  const d = setup(async () => {
    throw new Error("no request");
  });
  for (const signedXdr of ["", "s".repeat(100001), 1])
    await assert.rejects(
      d.funding.signPrepared(artifact(), async () => ({ signedXdr }), { walletAddress: wallet }),
      TypeError,
    );
  for (const signedXdr of ["s", "s".repeat(100000)])
    assert.equal(
      (
        await d.funding.signPrepared(artifact(), async () => ({ signedXdr }), {
          walletAddress: wallet,
        })
      ).submission.signedXdr,
      signedXdr,
    );
  await assert.rejects(
    d.funding.signPrepared(
      artifact(),
      async () => {
        throw new Error("secret signed XDR");
      },
      { walletAddress: wallet },
    ),
    (e) =>
      e instanceof PaiflowSigningError &&
      e.message === "Wallet signing failed" &&
      e.cause === undefined,
  );
});
test("sign abort/timeout retain preparation and do not submit or reprepare", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response(prepared);
  });
  const p = artifact();
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    d.funding.signPrepared(p, async () => ({ signedXdr: "s" }), {
      walletAddress: wallet,
      signal: c.signal,
    }),
    PaiflowAbortError,
  );
  await assert.rejects(
    d.funding.signPrepared(p, async () => new Promise(() => {}), {
      walletAddress: wallet,
      timeoutMs: 5,
    }),
    PaiflowTimeoutError,
  );
  assert.equal(p.data.intent, id);
  assert.equal(p.data.txHash, txHash);
  assert.equal(calls, 0);
});
test("additive response fields tolerated; canonical request metadata retained", async () => {
  const d = setup(async () =>
    response(
      { ...prepared, future: true },
      { "x-history-request-id": id, "x-request-id": "request-123" },
    ),
  );
  const p = await d.funding.prepare(input);
  assert.equal(p.data.amountStroops, input.amountStroops);
  assert.equal("future" in p.data, false);
  assert.equal(p.metadata.historyRequestId, id);
  assert.equal(p.metadata.requestId, "request-123");
});

test("committed OpenAPI funding examples parse without changing receipt fields", async () => {
  const document = JSON.parse(
    await readFile(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
  );
  const base = "/api/v1/deployments/{id}/funding";
  const sample = (path, method) =>
    document.paths[path][method].responses["200"].content["application/json"].example.data;
  const discoveryFixture = sample(base, "get");
  const preparedFixture = sample(base, "post");
  const recoveryFixture = sample(`${base}/reconcile`, "post");
  const d = setup(async (_, init) =>
    response(
      init.method === "GET"
        ? discoveryFixture
        : JSON.parse(init.body).fromAddress
          ? preparedFixture
          : recoveryFixture,
    ),
  );
  assert.deepEqual((await d.funding.get()).data, discoveryFixture);
  assert.deepEqual((await d.funding.prepare(input)).data, preparedFixture);
  assert.deepEqual(
    (await d.funding.reconcile({ action: "schedule.fund", intent: preparedFixture.intent })).data,
    recoveryFixture,
  );
});
