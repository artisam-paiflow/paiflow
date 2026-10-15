import assert from "node:assert/strict";
import { test } from "node:test";
import { Paiflow, PaiflowApiError, PaiflowMalformedResponseError } from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111",
  txHash = "a".repeat(64);
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const prepared = (action) => ({
  intent: id,
  txHash,
  expiresAt: "2099-01-01T00:00:00Z",
  unsignedXdr: "unsigned",
  network: "testnet",
  action,
  nodeId: "schedule",
  contractAddress: contract,
  walletAddress: wallet,
  ...(action === "retrieve"
    ? {
        recipient: wallet,
        estimatedAmountStroops: "9007199254740993",
        tokenContractAddress: contract,
      }
    : {}),
});
const state = {
  deploymentId: id,
  network: "testnet",
  nodeId: "schedule",
  contractAddress: contract,
  controller: wallet,
  tokenContractAddress: contract,
  paused: false,
  pauseAllowed: true,
  retrieveAllowed: true,
  balanceStroops: "7",
  availableStroops: "9007199254740993",
  claimedStroops: "3",
  unvestedStroops: "0",
  retrievableStroops: "0",
  retrievalRecipient: wallet,
  readAt: "2026-10-13T00:00:00Z",
  controlEligibility: {
    walletProtocolSupported: true,
    pause: true,
    resume: false,
    retrieve: false,
  },
};
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id);
for (const action of ["pause", "resume", "retrieve"])
  test(`${action} explicit prepare/sign/submit/reconcile retains artifact`, async () => {
    const calls = [];
    const d = setup(async (url, init) => {
      calls.push({ url: String(url), init });
      return response(
        calls.length === 1
          ? prepared(action)
          : calls.length === 2
            ? { txHash, network: "testnet", status: "PENDING" }
            : {
                intent: id,
                txHash,
                network: "testnet",
                action,
                state: "SUBMITTING",
                replacementAllowed: false,
              },
        { "x-history-request-id": id },
      );
    });
    const p = await d.schedule[action].prepare({
      nodeId: "schedule",
      walletAddress: wallet,
      amountStroops: "8",
      recipient: contract,
    });
    assert.deepEqual(JSON.parse(calls[0].init.body), { nodeId: "schedule", walletAddress: wallet });
    let signed = 0;
    const s = await d.schedule[action].signPrepared(
      p,
      async (r) => {
        signed++;
        assert.equal(r.xdr, "unsigned");
        assert.equal(r.networkPassphrase, "Test SDF Network ; September 2015");
        assert.equal(r.walletAddress, wallet);
        return { signedXdr: "signed" };
      },
      { walletAddress: wallet, expectedNetwork: "testnet" },
    );
    assert.equal(s.preparation, p);
    assert.equal(s.submissionOptions.preparationRequestId, id);
    assert.deepEqual(s.submission, { intent: id, signedXdr: "signed" });
    assert.equal(signed, 1);
    await d.schedule[action].submit(
      { ...s.submission, action, recipient: contract },
      s.submissionOptions,
    );
    assert.deepEqual(JSON.parse(calls[1].init.body), { intent: id, signedXdr: "signed" });
    const r = await d.schedule[action].reconcile({ intent: id });
    assert.equal(r.data.replacementAllowed, false);
    assert.equal(calls.length, 3);
    assert.ok(calls[2].url.endsWith(`/schedule/${action}/reconcile`));
    if (action !== "retrieve") assert.equal("recipient" in p.data, false);
  });
for (const controller of [wallet, contract])
  test(`state preserves holdings/entitlement and ${controller[0]} controller`, async () => {
    let url;
    const s = await setup(async (u) => {
      url = String(u);
      return response({ ...state, controller, retrievalRecipient: controller });
    }).schedule.get({ nodeId: "node /" });
    assert.ok(url.endsWith("nodeId=node+%2F"));
    assert.equal(s.data.controller, controller);
    assert.equal(s.data.availableStroops, "9007199254740993");
    assert.equal(s.data.balanceStroops, "7");
  });
test("bad inputs never request or sign", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    throw Error();
  });
  for (const nodeId of ["", "x".repeat(129)])
    assert.throws(() => d.schedule.get({ nodeId }), TypeError);
  assert.throws(() => d.schedule.pause.prepare({ walletAddress: contract }), TypeError);
  for (const signedXdr of ["", "x".repeat(100001)])
    assert.throws(() => d.schedule.pause.submit({ intent: id, signedXdr }), TypeError);
  for (const data of [
    { ...prepared("pause"), action: "resume" },
    { ...prepared("pause"), walletAddress: contract },
    { ...prepared("pause"), network: "bogus" },
    { ...prepared("pause"), expiresAt: "2000-01-01T00:00:00Z" },
  ])
    await assert.rejects(
      d.schedule.pause.signPrepared(
        { data, metadata: { status: 200 } },
        async () => {
          calls++;
          return { signedXdr: "s" };
        },
        { walletAddress: wallet },
      ),
      TypeError,
    );
  await assert.rejects(
    d.schedule.pause.signPrepared(
      { data: prepared("pause"), metadata: { status: 200 } },
      async () => {
        calls++;
        return { signedXdr: "s" };
      },
      { walletAddress: wallet, expectedNetwork: "mainnet" },
    ),
    TypeError,
  );
  assert.equal(calls, 0);
});
test("server conflicts preserve reservation identity and cause no retry", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: { code: "CONFLICT", message: "reserved", fields: { intent: id, txHash } },
      }),
      { status: 409 },
    );
  });
  await assert.rejects(
    d.schedule.retrieve.prepare({ walletAddress: wallet }),
    (e) => e instanceof PaiflowApiError && e.fields.intent === id && e.fields.txHash === txHash,
  );
  assert.equal(calls, 1);
});
for (const [stateName, replacementAllowed] of [
  ["PREPARED", false],
  ["SUBMITTING", false],
  ["SUCCESS", true],
  ["FAILED", true],
  ["EXPIRED", true],
])
  test(`server ${stateName} replacement proof preserved without writes`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return response({
        intent: id,
        txHash,
        network: "mainnet",
        action: "pause",
        state: stateName,
        replacementAllowed,
      });
    });
    assert.equal(
      (await d.schedule.pause.reconcile({ intent: id })).data.replacementAllowed,
      replacementAllowed,
    );
    assert.equal(calls, 1);
  });
test("malformed wire data rejected", async () => {
  for (const patch of [
    { balanceStroops: "01" },
    { availableStroops: 7 },
    { controller: "invalid" },
    { readAt: "bad" },
    { controlEligibility: {} },
  ])
    await assert.rejects(
      setup(async () => response({ ...state, ...patch })).schedule.get(),
      PaiflowMalformedResponseError,
    );
  for (const data of [
    { ...prepared("retrieve"), recipient: undefined },
    { ...prepared("retrieve"), estimatedAmountStroops: "-1" },
    prepared("resume"),
  ])
    await assert.rejects(
      setup(async () => response(data)).schedule.retrieve.prepare({ walletAddress: wallet }),
      PaiflowMalformedResponseError,
    );
  await assert.rejects(
    setup(async () =>
      response({ intent: id, txHash, network: "testnet", action: "pause", state: "SUBMITTING" }),
    ).schedule.pause.reconcile({ intent: id }),
    PaiflowMalformedResponseError,
  );
});
test("sign cancellation/failure never writes and retains caller artifact", async () => {
  const d = setup(async () => {
    throw Error("unexpected write");
  });
  const p = { data: prepared("pause"), metadata: { status: 200, historyRequestId: id } };
  await assert.rejects(
    d.schedule.pause.signPrepared(
      p,
      async () => {
        throw Error("denied");
      },
      { walletAddress: wallet },
    ),
    { name: "PaiflowSigningError" },
  );
  const abort = new AbortController();
  abort.abort();
  let signs = 0;
  await assert.rejects(
    d.schedule.pause.signPrepared(
      p,
      async () => {
        signs++;
        return { signedXdr: "s" };
      },
      { walletAddress: wallet, signal: abort.signal },
    ),
    { name: "PaiflowAbortError" },
  );
  assert.equal(signs, 0);
  assert.equal(p.data.intent, id);
  assert.equal(p.data.unsignedXdr, "unsigned");
});
test("boundary inputs preserve allowed node and signed envelope lengths", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push(JSON.parse(init.body));
    return response(
      calls.length === 1 ? prepared("pause") : { txHash, network: "testnet", status: "UNKNOWN" },
    );
  });
  await d.schedule.pause.prepare({ nodeId: "x".repeat(128), walletAddress: wallet });
  const result = await d.schedule.pause.submit({ intent: id, signedXdr: "s".repeat(100000) });
  assert.equal(calls[0].nodeId.length, 128);
  assert.equal(calls[1].signedXdr.length, 100000);
  assert.equal(result.data.status, "UNKNOWN");
  assert.equal(calls.length, 2);
});
for (const status of ["UNKNOWN", "REJECTED", "FAILED", "SUCCESS"])
  test(`submit ${status} retained without writes/retries`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return response({ txHash, network: "testnet", status });
    });
    assert.equal(
      (await d.schedule.resume.submit({ intent: id, signedXdr: "signed" })).data.status,
      status,
    );
    assert.equal(calls, 1);
  });
for (const status of [403, 409, 422])
  test(`control refusal ${status} stays explicit`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: {
            code: status === 403 ? "FORBIDDEN" : status === 409 ? "CONFLICT" : "VALIDATION",
            message: "not eligible",
          },
        }),
        { status },
      );
    });
    await assert.rejects(d.schedule.resume.prepare({ walletAddress: wallet }), PaiflowApiError);
    assert.equal(calls, 1);
  });
