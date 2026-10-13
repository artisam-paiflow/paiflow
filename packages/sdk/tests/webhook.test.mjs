import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Paiflow,
  PaiflowApiError,
  PaiflowMalformedResponseError,
  PaiflowTimeoutError,
} from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111",
  txHash = "a".repeat(64);
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const options = { webhookSecret: "separate-webhook-secret", idempotencyKey: "task-completed:42" };
const response = (data, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { "x-request-id": "request-42", "Retry-After": "2" },
  });
const setup = (fetch, token = "pfk_test") =>
  new Paiflow({ baseUrl: "https://example.com", token, fetch }).deployment(id);
for (const status of ["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"])
  for (const hasHash of [true, false])
    test(`keyed ${status} ${hasHash ? "with" : "without"} hash remains explicit`, async () => {
      const calls = [];
      const d = setup(async (url, init) => {
        calls.push({ url: String(url), init });
        return response(
          {
            attemptId: id,
            network: "testnet",
            status,
            ...(hasHash ? { txHash } : {}),
            ...(status === "FAILED" ? { error: { code: "FUTURE_CODE", message: "failed" } } : {}),
            future: "ignored",
          },
          ["PENDING", "UNKNOWN"].includes(status) ? 202 : 200,
        );
      });
      const r = await d.webhook.trigger(
        {
          escrow: true,
          amount: "9007199254740993",
          secretKey: "never-forward",
          from: wallet,
          auth: ["ignored"],
        },
        options,
      );
      assert.equal(r.data.status, status);
      assert.equal(r.data.attemptId, id);
      assert.equal(r.data.txHash, hasHash ? txHash : undefined);
      assert.equal(r.metadata.status, ["PENDING", "UNKNOWN"].includes(status) ? 202 : 200);
      assert.equal(r.metadata.retryAfter, "2");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `https://example.com/api/webhooks/${id}`);
      assert.equal(calls[0].init.headers.get("Authorization"), null);
      assert.equal(calls[0].init.headers.get("x-webhook-secret"), options.webhookSecret);
      assert.equal(calls[0].init.headers.get("Idempotency-Key"), options.idempotencyKey);
      assert.deepEqual(JSON.parse(calls[0].init.body), {
        escrow: true,
        amount: "9007199254740993",
      });
      assert.equal("future" in r.data, false);
    });
test("explicit same-key retry preserves event identity and native authorization", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push(init);
    return response({
      attemptId: id,
      network: "mainnet",
      status: calls.length === 1 ? "UNKNOWN" : "SUCCESS",
      txHash,
    });
  }, undefined);
  const body = {
    from: wallet,
    amount: "7",
    auth: ["opaque-signed-entry"],
    privateKey: "never-forward",
  };
  assert.equal((await d.webhook.trigger(body, options)).data.status, "UNKNOWN");
  assert.equal(calls.length, 1);
  assert.equal((await d.webhook.trigger(body, options)).data.status, "SUCCESS");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(JSON.parse(calls[0].body), {
    from: wallet,
    amount: "7",
    auth: ["opaque-signed-entry"],
  });
  assert.equal(calls[1].headers.get("Idempotency-Key"), options.idempotencyKey);
});
test("zero and omitted pool amounts preserve whole-pool forms; native optional fields preserved", async () => {
  const bodies = [];
  const d = setup(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return response({ attemptId: id, network: "testnet", status: "PENDING" }, 202);
  });
  for (const body of [
    { escrow: true },
    { escrow: true, amount: "0" },
    { escrow: false, from: wallet, amount: "0" },
    { from: wallet, amount: "7", auth: [] },
  ])
    await d.webhook.trigger(body, options);
  assert.deepEqual(bodies, [
    { escrow: true },
    { escrow: true, amount: "0" },
    { escrow: false, from: wallet, amount: "0" },
    { from: wallet, amount: "7", auth: [] },
  ]);
});
test("legacy unkeyed response has no invented attempt, network, success or key", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push(init);
    return response(calls.length === 1 ? { txHash } : { txHash, status: "PENDING" });
  });
  const a = await d.webhook.triggerUnkeyed({ escrow: true }, { ...options });
  assert.deepEqual(a.data, { txHash });
  assert.equal(calls.length, 1);
  const b = await d.webhook.triggerUnkeyed({ escrow: true }, { ...options });
  assert.deepEqual(b.data, { txHash, status: "PENDING" });
  for (const c of calls) {
    assert.equal(c.headers.get("Idempotency-Key"), null);
    assert.equal(c.headers.get("Authorization"), null);
  }
});
test("invalid payloads/keys/secrets rejected before request", () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    throw Error();
  });
  for (const body of [
    {},
    { escrow: "true" },
    { from: "bad", amount: "7" },
    { from: wallet },
    { escrow: true, amount: "01" },
    { escrow: true, amount: -1 },
    { escrow: true, amount: "-1" },
    { escrow: true, amount: String(1n << 127n) },
    { from: wallet, amount: "1", auth: "entry" },
    { from: wallet, amount: "1", auth: [7] },
  ])
    assert.throws(() => d.webhook.trigger(body, options), TypeError);
  for (const idempotencyKey of [undefined, "", "has space", "x".repeat(129), "evil\nheader"])
    assert.throws(
      () => d.webhook.trigger({ escrow: true }, { ...options, idempotencyKey }),
      TypeError,
    );
  for (const webhookSecret of [undefined, "", "evil\rheader"])
    assert.throws(
      () => d.webhook.trigger({ escrow: true }, { ...options, webhookSecret }),
      TypeError,
    );
  assert.equal(calls, 0);
});
test("bounds allow maximum i128 stroops and 128-character event keys", async () => {
  let body, key;
  const d = setup(async (url, init) => {
    body = JSON.parse(init.body);
    key = init.headers.get("Idempotency-Key");
    return response({ attemptId: id, network: "testnet", status: "PENDING" });
  });
  const amount = String((1n << 127n) - 1n);
  await d.webhook.trigger(
    { escrow: true, amount },
    { ...options, idempotencyKey: "k".repeat(128) },
  );
  assert.equal(body.amount, amount);
  assert.equal(key.length, 128);
});
for (const status of [403, 409, 422, 429, 502])
  test(`webhook refusal ${status} exposes metadata and never retries`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: {
            code: status === 409 ? "CONFLICT" : "FORBIDDEN",
            message: "refused",
            fields: { amount: ["invalid"] },
          },
        }),
        { status, headers: { "x-request-id": "refusal-42", "Retry-After": "2" } },
      );
    });
    await assert.rejects(
      d.webhook.trigger({ escrow: true }, options),
      (e) =>
        e instanceof PaiflowApiError &&
        e.status === status &&
        e.metadata.requestId === "refusal-42" &&
        e.metadata.retryAfter === "2",
    );
    assert.equal(calls, 1);
  });
test("timeout never generates a new key or replays either callback", async () => {
  for (const keyed of [true, false]) {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Promise(() => {});
    });
    await assert.rejects(
      d.webhook[keyed ? "trigger" : "triggerUnkeyed"](
        { escrow: true },
        { ...options, timeoutMs: 5 },
      ),
      PaiflowTimeoutError,
    );
    assert.equal(calls, 1);
  }
});
test("signed authorization and credentials echoed anywhere in errors are redacted", async () => {
  const signed = "opaque-signed-Soroban-entry";
  const d = setup(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION",
            message: `invalid ${signed} ${options.webhookSecret}`,
            fields: { auth: ["Invalid authorization entry"], nested: { echoed: signed } },
            details: [signed, { note: signed }],
          },
        }),
        { status: 422 },
      ),
  );
  await assert.rejects(
    d.webhook.trigger({ from: wallet, amount: "7", auth: [signed] }, options),
    (e) => {
      assert.ok(e instanceof PaiflowApiError);
      assert.equal(JSON.stringify(e).includes(signed), false);
      assert.equal(e.message.includes(signed), false);
      assert.equal(e.message.includes(options.webhookSecret), false);
      assert.deepEqual(e.fields.auth, ["Invalid authorization entry"]);
      return true;
    },
  );
});
test("malformed keyed and unkeyed response shapes are rejected", async () => {
  for (const data of [
    { attemptId: id, status: "UNKNOWN" },
    { attemptId: "bad", network: "testnet", status: "PENDING" },
    { attemptId: id, network: "testnet", status: "PREPARING" },
    { attemptId: id, network: "testnet", status: "SUCCESS", txHash: "bad" },
    { attemptId: id, network: "testnet", status: "FAILED", error: { code: "bad" } },
  ])
    await assert.rejects(
      setup(async () => response(data)).webhook.trigger({ escrow: true }, options),
      PaiflowMalformedResponseError,
    );
  for (const data of [{}, { txHash, status: "SUCCESS" }])
    await assert.rejects(
      setup(async () => response(data)).webhook.triggerUnkeyed({ escrow: true }, options),
      PaiflowMalformedResponseError,
    );
});
test("early release empty/selected body uses only deployment token", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ nodeId: "deadline", txHash, ledger: 7, future: true });
  });
  const r = await d.releaseEarly();
  assert.deepEqual(r.data, { nodeId: "deadline", txHash, ledger: 7 });
  await d.releaseEarly({
    nodeId: " deadline ",
    privateKey: "ignored",
    webhookSecret: options.webhookSecret,
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
  assert.deepEqual(JSON.parse(calls[1].init.body), { nodeId: "deadline" });
  for (const { url, init } of calls) {
    assert.equal(url, `https://example.com/api/v1/deployments/${id}/release-early`);
    assert.equal(init.headers.get("Authorization"), "Bearer pfk_test");
    assert.equal(init.headers.get("x-webhook-secret"), null);
    assert.equal(init.headers.get("Idempotency-Key"), null);
  }
});
for (const message of [
  "The deployment is not confirmed yet",
  "This deployment has no timelock branch to release",
  "Several timelock branches; pass nodeId",
  "The deadline has passed",
  "There is nothing to release",
  "Unknown timelock branch node",
])
  test(`early release eligibility remains server authority: ${message}`, async () => {
    let calls = 0;
    const d = setup(async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: "VALIDATION", message, fields: { nodeId: [message] } } }),
        { status: 422, headers: { "x-request-id": "release-42" } },
      );
    });
    await assert.rejects(
      d.releaseEarly(),
      (e) =>
        e instanceof PaiflowApiError &&
        e.message === message &&
        e.metadata.requestId === "release-42",
    );
    assert.equal(calls, 1);
  });
test("early release rejects invalid inputs/results and requires token independently", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return response({ nodeId: "deadline", txHash });
  });
  for (const value of [null, [], { nodeId: " " }, { nodeId: "x".repeat(129) }, { nodeId: 7 }])
    assert.throws(() => d.releaseEarly(value), TypeError);
  assert.equal(calls, 0);
  await assert.rejects(
    new Paiflow({
      baseUrl: "https://example.com",
      fetch: async () => {
        calls++;
        throw Error();
      },
    })
      .deployment(id)
      .releaseEarly(),
    TypeError,
  );
  assert.equal(calls, 0);
  for (const data of [
    { txHash },
    { nodeId: "deadline", txHash: "bad" },
    { nodeId: "deadline", txHash, ledger: 1.5 },
  ])
    await assert.rejects(
      setup(async () => response(data)).releaseEarly(),
      PaiflowMalformedResponseError,
    );
});

test("same key with changed effective arguments returns server conflict without local replay", async () => {
  const calls = [];
  const d = setup(async (url, init) => {
    calls.push({ key: init.headers.get("Idempotency-Key"), body: JSON.parse(init.body) });
    if (calls.length === 1)
      return response({ attemptId: id, network: "testnet", status: "UNKNOWN" }, 202);
    return new Response(
      JSON.stringify({
        error: {
          code: "CONFLICT",
          message: "Idempotency-Key was already used with a different request",
        },
      }),
      { status: 409 },
    );
  });
  await d.webhook.trigger({ escrow: true, amount: "7" }, options);
  await assert.rejects(
    d.webhook.trigger({ escrow: true, amount: "8" }, options),
    (e) => e instanceof PaiflowApiError && e.code === "CONFLICT" && e.status === 409,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.deepEqual(
    calls.map((c) => c.body.amount),
    ["7", "8"],
  );
});
