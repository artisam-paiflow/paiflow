import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Paiflow,
  PaiflowApiError,
  PaiflowMalformedResponseError,
  PaiflowSigningError,
  PaiflowAbortError,
} from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111",
  txHash = "a".repeat(64);
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const phrase = "Test SDF Network ; September 2015",
  intent = "opaque.signed-allowance-intent";
const state = {
  deploymentId: id,
  flowName: "",
  network: "testnet",
  contractAddress: contract,
  tokenContractAddress: contract,
  subscriber: wallet,
  isCancelled: false,
  asset: { kind: "native" },
  assetLabel: "XLM",
  allowance: "9007199254740993",
  setupRequired: false,
};
const prepared = (action) => ({
  intent: id,
  txHash,
  expiresAt: "2099-01-01T00:00:00Z",
  xdr: "unsigned",
  network: "testnet",
  networkPassphrase: phrase,
  action: `subscription.${action}`,
  walletAddress: wallet,
  nodeId: "subscription",
  contractAddress: contract,
  tokenContractAddress: contract,
});
const approval = {
  xdr: "unsigned",
  intent,
  txHash,
  networkPassphrase: phrase,
  allowance: "9007199254740994",
};
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id);
const artifact = (data) => ({ data, metadata: { status: 200, historyRequestId: id } });
for (const action of ["cancel", "reactivate"]) {
  test(`${action} follows exact prepare sign submit reconcile protocol`, async () => {
    const calls = [];
    const d = setup(async (url, init) => {
      calls.push({ url: String(url), init });
      return response(
        calls.length === 1
          ? prepared(action)
          : calls.length === 2
            ? { txHash, network: "testnet", status: "UNKNOWN" }
            : {
                intent: id,
                txHash,
                action: `subscription.${action}`,
                state: "SUBMITTING",
                ledger: null,
                replacementAllowed: false,
              },
        { "x-history-request-id": id },
      );
    });
    const p = await d.subscription[action].prepare({ walletAddress: wallet, amount: "1" });
    assert.equal(
      calls[0].url,
      `https://example.com/api/v1/deployments/${id}/subscription/${action}/prepare`,
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), { walletAddress: wallet });
    const signed = await d.subscription[action].signPrepared(
      p,
      async (r) => {
        assert.equal(r.xdr, "unsigned");
        assert.equal(r.networkPassphrase, phrase);
        assert.equal(r.walletAddress, wallet);
        return { signedXdr: "s" };
      },
      { walletAddress: wallet },
    );
    assert.equal(signed.preparation, p);
    assert.deepEqual(signed.submission, { intent: id, signedXdr: "s" });
    await d.subscription[action].submit(signed.submission, signed.submissionOptions);
    assert.equal(calls[1].init.headers.get("x-preparation-request-id"), id);
    const r = await d.subscription[action].reconcile({ intent: id });
    assert.equal(r.data.replacementAllowed, false);
    assert.equal(r.data.ledger, null);
    assert.ok(calls.every((c) => c.init.headers.get("Authorization") === "Bearer pfk_test"));
    assert.equal(calls.length, 3);
  });
  test(`${action} server finality and expired reconciliation retain replacement field`, async () => {
    for (const s of ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]) {
      const d = setup(async () =>
        response({
          intent: id,
          txHash,
          action: `subscription.${action}`,
          state: s,
          ledger: s === "SUCCESS" ? 12 : null,
          replacementAllowed: ["SUCCESS", "FAILED", "EXPIRED"].includes(s),
        }),
      );
      assert.equal((await d.subscription[action].reconcile({ intent: id })).data.state, s);
    }
  });
  test(`${action} wrong action network wallet expiry fail before signing`, async () => {
    let called = 0;
    const d = setup(async () => {
      throw Error("no HTTP");
    });
    for (const patch of [
      { action: `subscription.${action === "cancel" ? "reactivate" : "cancel"}` },
      { network: "mainnet" },
      { walletAddress: contract },
      { expiresAt: "2000-01-01T00:00:00Z" },
      { intent },
    ])
      await assert.rejects(
        d.subscription[action].signPrepared(
          artifact({ ...prepared(action), ...patch }),
          async () => {
            called++;
            return { signedXdr: "signed" };
          },
          { walletAddress: wallet },
        ),
        TypeError,
      );
    assert.equal(called, 0);
  });
}
test("token state and public state preserve distinct source shapes and unconfigured Dev", async () => {
  const d = setup(async (url) =>
    response(
      String(url).includes("/v1/")
        ? {
            ...state,
            subscriber: null,
            setupRequired: true,
            allowance: "0",
            templateKind: "SUBSCRIPTION_DEV",
          }
        : state,
    ),
  );
  assert.equal((await d.subscription.get()).data.templateKind, "SUBSCRIPTION_DEV");
  assert.deepEqual((await d.subscription.allowance.get()).data, state);
  assert.equal("templateKind" in (await d.subscription.allowance.get()).data, false);
});
test("public allowance get prepare sign submit status never send bearer credentials", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(
      calls.length === 1 ? state : calls.length === 2 ? approval : { txHash, status: "PENDING" },
      { "x-history-request-id": id },
    );
  });
  const s = await d.subscription.allowance.get();
  const p = await d.subscription.allowance.prepare({ amount: "0001", userAddress: wallet });
  assert.deepEqual(JSON.parse(calls[1].init.body), { amount: "0001", userAddress: wallet });
  assert.equal(p.data.allowance, "9007199254740994");
  let count = 0;
  const signed = await d.subscription.allowance.signPrepared(
    p,
    s,
    async (r) => {
      count++;
      assert.equal(r.networkPassphrase, phrase);
      return { signedXdr: "signed-xdr" };
    },
    { walletAddress: wallet },
  );
  assert.equal(signed.preparation, p);
  assert.equal(count, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(signed.submission, { intent, signedXdr: "signed-xdr" });
  await d.subscription.allowance.submit(signed.submission, signed.submissionOptions);
  await d.subscription.allowance.status({ intent });
  assert.equal(new URL(calls[3].url).searchParams.get("intent"), intent);
  assert.ok(calls.every((c) => !c.init.headers.has("Authorization")));
  assert.equal(calls.length, 4);
});
test("public allowance works without a configured token", async () => {
  const d = new Paiflow({
    baseUrl: "https://example.com",
    fetch: async () => response(state),
  }).deployment(id);
  await d.subscription.allowance.get();
  await assert.rejects(d.subscription.get(), /Deployment token required/);
});
test("allowance signing checks explicit scoped state before callback without decoding intent", async () => {
  let calls = 0;
  const d = setup(async () => {
    throw Error("no HTTP");
  });
  for (const patch of [
    { subscriber: null, setupRequired: true },
    { subscriber: contract },
    { isCancelled: true },
    { setupRequired: true },
    { deploymentId: "22222222-2222-4222-8222-222222222222" },
    { network: "mainnet" },
  ])
    await assert.rejects(
      d.subscription.allowance.signPrepared(
        artifact(approval),
        artifact({ ...state, ...patch }),
        async () => {
          calls++;
          return { signedXdr: "signed-xdr" };
        },
        { walletAddress: wallet },
      ),
      TypeError,
    );
  assert.equal(calls, 0);
});
test("allowance amount source i128 and leading zero bounds validate before fetch", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response(approval);
  });
  for (const amount of ["0", "000", "-1", "1.2", "1e7", "1".repeat(40), (1n << 127n).toString(), 1])
    assert.throws(
      () => d.subscription.allowance.prepare({ amount, userAddress: wallet }),
      TypeError,
    );
  await d.subscription.allowance.prepare({
    amount: ((1n << 127n) - 1n).toString(),
    userAddress: wallet,
  });
  assert.equal(calls, 1);
});
test("control UUID and signed limits differ from allowance opaque and signed limits", async () => {
  let calls = 0;
  const d = setup(async (url) => {
    calls++;
    return response(
      String(url).includes("/v1/")
        ? { txHash, network: "testnet", status: "PENDING" }
        : { txHash, status: "PENDING" },
    );
  });
  assert.throws(() => d.subscription.cancel.submit({ intent, signedXdr: "s" }), TypeError);
  for (const signedXdr of ["", "s".repeat(100001)])
    assert.throws(() => d.subscription.cancel.submit({ intent: id, signedXdr }), TypeError);
  await d.subscription.cancel.submit({ intent: id, signedXdr: "s".repeat(100000) });
  for (const signedXdr of ["s".repeat(9), "s".repeat(200001)])
    assert.throws(() => d.subscription.allowance.submit({ intent, signedXdr }), TypeError);
  await d.subscription.allowance.submit({ intent, signedXdr: "s".repeat(200000) });
  for (const bad of ["s".repeat(9), "s".repeat(4097)])
    assert.throws(() => d.subscription.allowance.status({ intent: bad }), TypeError);
  await d.subscription.allowance.status({ intent: "s".repeat(4096) });
  assert.equal(calls, 3);
});
for (const code of ["FORBIDDEN", "CONFLICT", "VALIDATION", "UPSTREAM_RPC", "RATE_LIMITED"])
  test(`subscription propagates ${code} without an automatic second action`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code, message: "Denied" } }), { status: 409 });
    });
    await assert.rejects(
      d.subscription.cancel.prepare({ walletAddress: wallet }),
      (e) => e instanceof PaiflowApiError && e.code === code,
    );
    assert.equal(calls, 1);
  });
test("opaque intent signed XDR and token are redacted in public failure diagnostics", async () => {
  const signedXdr = "secret-signed-envelope";
  const d = setup(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION",
            message: `${intent} ${signedXdr} pfk_test`,
            details: { intent, signedXdr },
          },
        }),
        { status: 422 },
      ),
  );
  await assert.rejects(
    d.subscription.allowance.submit({ intent, signedXdr }),
    (e) =>
      !JSON.stringify(e).includes(intent) &&
      !JSON.stringify(e).includes(signedXdr) &&
      !e.message.includes("pfk_test"),
  );
  await assert.rejects(
    d.subscription.allowance.status({ intent }),
    (e) => !e.message.includes(intent),
  );
});
test("unknown allowance submit is retained and status checks the same opaque intent", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) throw Error("uncertain");
    return response({ txHash, status: "PENDING" });
  });
  const p = artifact(approval);
  await assert.rejects(
    d.subscription.allowance.submit({ intent: p.data.intent, signedXdr: "signed-xdr" }),
  );
  const r = await d.subscription.allowance.status({ intent: p.data.intent });
  assert.equal(r.data.status, "PENDING");
  assert.equal(new URL(calls[1].url).searchParams.get("intent"), intent);
  assert.equal(calls.length, 2);
  assert.equal(p.data.txHash, txHash);
});
for (const status of ["SUCCESS", "FAILED", "PENDING"])
  test(`allowance status ${status} keeps its actual public shape`, async () => {
    const d = setup(async () =>
      response({
        txHash,
        status,
        ...(status === "FAILED" ? { errorMessage: "Approval expired without confirmation" } : {}),
      }),
    );
    const r = await d.subscription.allowance.status({ intent });
    assert.equal(r.data.status, status);
    assert.equal("replacementAllowed" in r.data, false);
    assert.equal("network" in r.data, false);
  });
test("malformed Subscription/public allowance responses are rejected without leaking content", async () => {
  for (const data of [
    { ...state, allowance: (1n << 127n).toString() },
    { ...state, subscriber: "bad" },
    { ...state, setupRequired: "false" },
  ]) {
    const d = setup(async () => response(data));
    await assert.rejects(d.subscription.allowance.get(), PaiflowMalformedResponseError);
  }
  const d = setup(async () => response({ ...approval, intent: "short" }));
  await assert.rejects(
    d.subscription.allowance.prepare({ amount: "1", userAddress: wallet }),
    PaiflowMalformedResponseError,
  );
});
test("allowance wallet rejection and abort retain original preparation without requests", async () => {
  const d = setup(async () => {
    throw Error("no HTTP");
  });
  const p = artifact(approval),
    s = artifact(state);
  await assert.rejects(
    d.subscription.allowance.signPrepared(
      p,
      s,
      async () => {
        throw Error(intent);
      },
      { walletAddress: wallet },
    ),
    PaiflowSigningError,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    d.subscription.allowance.signPrepared(
      p,
      s,
      async () => {
        throw Error("must not sign");
      },
      { walletAddress: wallet, signal: controller.signal },
    ),
    PaiflowAbortError,
  );
  assert.deepEqual(p.data, approval);
});

test("committed OpenAPI Subscription examples preserve source receipt and metadata shapes", async () => {
  const { readFile } = await import("node:fs/promises");
  const spec = JSON.parse(
    await readFile(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
  );
  const prefix = "/api/v1/deployments/{id}/subscription";
  const example = (suffix, method = "post") =>
    spec.paths[`${prefix}/${suffix}`][method].responses["200"].content["application/json"].example
      .data;
  const d = setup(async (url) => {
    const suffix = String(url).split("/subscription/")[1];
    return response(example(suffix, suffix === "state" ? "get" : "post"));
  });
  assert.deepEqual((await d.subscription.get()).data, example("state", "get"));
  for (const action of ["cancel", "reactivate"]) {
    assert.deepEqual(
      (await d.subscription[action].prepare({ walletAddress: wallet })).data,
      example(`${action}/prepare`),
    );
    assert.deepEqual(
      (await d.subscription[action].submit({ intent: id, signedXdr: "signed" })).data,
      example(`${action}/submit`),
    );
    assert.deepEqual(
      (await d.subscription[action].reconcile({ intent: id })).data,
      example(`${action}/reconcile`),
    );
  }
});

test("public preparation tolerates additive fields without inventing authenticated subscriber metadata", async () => {
  const d = setup(async () => response({ ...approval, newField: 1 }));
  const p = await d.subscription.allowance.prepare({ amount: "1", userAddress: wallet });
  assert.deepEqual(p.data, approval);
  assert.equal("walletAddress" in p.data, false);
  assert.equal("network" in p.data, false);
  assert.equal("expiresAt" in p.data, false);
});

test("subscription signed callback bounds and network are checked with no hidden actions", async () => {
  const d = setup(async () => {
    throw Error("no HTTP");
  });
  const p = artifact(prepared("cancel"));
  await assert.rejects(
    d.subscription.cancel.signPrepared(p, async () => ({ signedXdr: "s".repeat(100001) }), {
      walletAddress: wallet,
    }),
    TypeError,
  );
  await assert.rejects(
    d.subscription.allowance.signPrepared(
      artifact(approval),
      artifact(state),
      async () => ({ signedXdr: "short" }),
      { walletAddress: wallet },
    ),
    TypeError,
  );
  let called = 0;
  await assert.rejects(
    d.subscription.allowance.signPrepared(
      artifact(approval),
      artifact(state),
      async () => {
        called++;
        return { signedXdr: "signed-xdr" };
      },
      { walletAddress: wallet, expectedNetwork: "mainnet" },
    ),
    TypeError,
  );
  assert.equal(called, 0);
});
