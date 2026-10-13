import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Paiflow,
  signPrepared,
  PaiflowSigningError,
  PaiflowAbortError,
  PaiflowTimeoutError,
  PaiflowMalformedResponseError,
  PaiflowApiError,
} from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111",
  txHash = "a".repeat(64);
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const passphrase = "Test SDF Network ; September 2015",
  xdr = "unsigned-envelope",
  signedXdr = "signed-envelope";
const prepared = {
  xdr,
  networkPassphrase: passphrase,
  network: "testnet",
  expiresAt: "2099-01-01T00:00:00Z",
};
const response = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://example.com", token: "pfk_test", fetch }).deployment(id);
const artifact = (data = prepared) => ({ data, metadata: { status: 200, historyRequestId: id } });
test("explicit prepare, sign and submit retain artifact and history, wait query, strip extras", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1
      ? response(prepared, { "x-history-request-id": id })
      : response({ txHash, status: "SUCCESS", ledger: 123 });
  });
  const p = await d.execute.prepare({
    amount: "9007199254740993",
    from: wallet,
    secretKey: "forbidden",
  });
  const signed = await signPrepared(
    p,
    async (r) => {
      assert.equal(r.xdr, xdr);
      assert.equal(r.networkPassphrase, passphrase);
      assert.equal(r.walletAddress, wallet);
      return { signedXdr };
    },
    { walletAddress: wallet, expectedNetwork: "testnet" },
  );
  assert.equal(signed.preparation, p);
  const result = await d.execute.submit(
    { ...signed.submission, secretKey: "forbidden" },
    { ...signed.submissionOptions, wait: false },
  );
  assert.equal(result.data.status, "SUCCESS");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: "9007199254740993", from: wallet });
  assert.deepEqual(JSON.parse(calls[1].init.body), { signedXdr });
  assert.match(String(calls[1].url), /wait=false/);
  assert.equal(calls[1].init.headers.get("x-preparation-request-id"), id);
});
for (const status of ["PENDING", "FAILED"])
  test(`HTTP 200 ${status} remains explicit result`, async () => {
    const d = setup(async () =>
      response({
        txHash,
        status,
        ...(status === "FAILED" ? { error: { code: "ONCHAIN_FAILED", message: "failed" } } : {}),
      }),
    );
    assert.equal((await d.execute.submit({ signedXdr })).data.status, status);
  });
test("uncertain submit is never automatically retried or rebuilt; same envelope explicit retry", async () => {
  const bodies = [];
  const d = setup(async (_, init) => {
    bodies.push(init.body);
    if (bodies.length === 1)
      return new Response(
        JSON.stringify({ error: { code: "UPSTREAM_RPC", message: "uncertain" } }),
        { status: 502 },
      );
    return response({ txHash, status: "PENDING" });
  });
  await assert.rejects(d.execute.submit({ signedXdr }), PaiflowApiError);
  assert.equal(bodies.length, 1);
  await d.execute.submit({ signedXdr });
  assert.equal(bodies[0], bodies[1]);
});
test("transport failure makes one request", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    throw new Error("signed secret");
  });
  await assert.rejects(d.execute.submit({ signedXdr }), (e) => !e.message.includes("secret"));
  assert.equal(calls, 1);
});
test("public legacy shapes omit invented metadata and bearer; status global pending retained", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push(init);
    if (String(url).endsWith("/trigger")) return response({ xdr, networkPassphrase: passphrase });
    if (String(url).endsWith("/submit-trigger")) return response({ txHash });
    return response({ txHash, status: "PENDING" });
  });
  const p = await d.publicPayment.prepare({ amount: "1", userAddress: wallet });
  assert.deepEqual(Object.keys(p.data).sort(), ["networkPassphrase", "xdr"]);
  assert.deepEqual((await d.publicPayment.submit({ signedXdr })).data, { txHash });
  assert.equal((await d.publicPayment.status(txHash.toUpperCase())).data.status, "PENDING");
  for (const init of calls) assert.equal(init.headers.has("authorization"), false);
});
test("public pending/failed status and malformed response boundaries", async () => {
  const d = setup(async () => response({ txHash, status: "FAILED", errorMessage: "failed" }));
  assert.equal((await d.publicPayment.status(txHash)).data.errorMessage, "failed");
  const bad = setup(async () => response({ ...prepared, network: "mainnet" }));
  await assert.rejects(
    bad.execute.prepare({ amount: "1", from: wallet }),
    PaiflowMalformedResponseError,
  );
  const missing = setup(async () => response({ txHash, status: "SUCCESS" }));
  await assert.rejects(missing.publicPayment.submit({ signedXdr }), PaiflowMalformedResponseError);
});
test("input validates stroop precision bounds, wallets and signed envelope lengths before requests", () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response({});
  });
  for (const amount of [1, "0", "1.2", "-1", (1n << 127n).toString(), "9".repeat(40)])
    assert.throws(() => d.execute.prepare({ amount, from: wallet }), TypeError);
  for (const from of ["secret", "C" + "A".repeat(55), wallet.slice(0, -1) + "A"])
    assert.throws(() => d.execute.prepare({ amount: "1", from }), TypeError);
  for (const signedXdr of ["short", "x".repeat(200001), 1])
    assert.throws(() => d.execute.submit({ signedXdr }), TypeError);
  assert.throws(() => d.execute.submit({ signedXdr }, { wait: "false" }), TypeError);
  assert.equal(calls, 0);
});
test("signing preserves intent/hash metadata and normalizes server schedule network", async () => {
  const p = artifact({
    unsignedXdr: xdr,
    network: "testnet",
    walletAddress: wallet,
    intent: id,
    txHash,
  });
  const s = await signPrepared(
    p,
    async (r) => {
      assert.equal(r.networkPassphrase, passphrase);
      return { signedXdr };
    },
    { walletAddress: wallet },
  );
  assert.equal(s.preparation, p);
  assert.equal(s.preparation.data.intent, id);
  assert.equal(s.preparation.data.txHash, txHash);
});
test("sign rejects network/wallet mismatch, expired/invalid artifacts before callback", async () => {
  let calls = 0;
  const signer = async () => {
    calls++;
    return { signedXdr };
  };
  for (const data of [
    { ...prepared, network: "mainnet" },
    { ...prepared, networkPassphrase: "unknown" },
    { ...prepared, expiresAt: "2020-01-01T00:00:00Z" },
    { ...prepared, walletAddress: "other" },
    { ...prepared, unsignedXdr: "different" },
  ])
    await assert.rejects(signPrepared(artifact(data), signer, { walletAddress: wallet }));
  await assert.rejects(
    signPrepared(artifact(), signer, { walletAddress: wallet, expectedNetwork: "mainnet" }),
  );
  await assert.rejects(signPrepared(artifact(), signer, { walletAddress: "secret" }));
  assert.equal(calls, 0);
});
test("sign callback errors are sanitized without cause/raw data", async () => {
  await assert.rejects(
    signPrepared(
      artifact(),
      async () => {
        throw new Error("secret signed XDR");
      },
      { walletAddress: wallet },
    ),
    (e) => {
      assert.ok(e instanceof PaiflowSigningError);
      assert.equal(e.cause, undefined);
      assert.equal(e.message, "Wallet signing failed");
      return true;
    },
  );
  for (const result of [{ signedXdr: "short" }, null, { signedXdr: 10 }])
    await assert.rejects(
      signPrepared(artifact(), async () => result, { walletAddress: wallet }),
      TypeError,
    );
});
test("sign cancellation and deadline settle even if callback never finishes", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    signPrepared(
      artifact(),
      async () => {
        calls++;
        return { signedXdr };
      },
      { walletAddress: wallet, signal: controller.signal },
    ),
    PaiflowAbortError,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    signPrepared(artifact(), async () => new Promise(() => {}), {
      walletAddress: wallet,
      timeoutMs: 5,
    }),
    PaiflowTimeoutError,
  );
  const active = new AbortController();
  await assert.rejects(
    signPrepared(
      artifact(),
      async (r) => {
        active.abort();
        assert.equal(r.signal.aborted, true);
        return { signedXdr };
      },
      { walletAddress: wallet, signal: active.signal },
    ),
    PaiflowAbortError,
  );
});
