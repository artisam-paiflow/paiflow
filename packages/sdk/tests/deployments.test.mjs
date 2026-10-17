import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import {
  Paiflow,
  PaiflowTransport,
  PaiflowApiError,
  PaiflowMalformedResponseError,
  PaiflowAbortError,
  PaiflowTimeoutError,
} from "../dist/index.js";
const ids = [1, 2, 3].map(
  (n) => `${String.fromCharCode(96 + n)}1111111-1111-4111-8111-111111111111`,
);
const token = `pfd_${"a".repeat(64)}`;
const other = `pfd_${"b".repeat(64)}`;
const item = (id) => ({ id, flowName: "Selected flow", network: "testnet" });
const json = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const client = (fetch, credential = token) =>
  new Paiflow({ baseUrl: "https://paiflow.example", token: credential, fetch });
const collect = async (pages) => {
  const results = [];
  for await (const page of pages) results.push(page);
  return results;
};

for (const credential of [token, "pfk_test"])
  test(`${credential.slice(0, 4)} discovery retains metadata and scoped deployment methods`, async () => {
    let requests = 0;
    const selected = credential === token ? ids.slice(0, 2) : [ids[0]];
    const sdk = client(async (url, init) => {
      requests++;
      assert.equal(init.headers.get("authorization"), `Bearer ${credential}`);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(url.origin, "https://paiflow.example");
      if (url.pathname === "/api/v1/deployments") {
        assert.equal(url.search, "?limit=2");
        assert.equal(init.headers.get("x-request-id"), "discover-1");
        return json(
          { items: selected.map(item), nextCursor: null, additive: true },
          {
            "x-request-id": "discover-1",
            "x-history-request-id": ids[0],
          },
        );
      }
      assert.ok(selected.some((id) => url.pathname === `/api/v1/deployments/${id}/events`));
      return json({ items: [], nextCursor: null, hasMore: false });
    }, credential);
    assert.equal(requests, 0);
    const response = await sdk.deployments.list({ limit: 2 }, { requestId: "discover-1" });
    assert.deepEqual(response, {
      data: { items: selected.map(item), nextCursor: null },
      metadata: { status: 200, requestId: "discover-1", historyRequestId: ids[0] },
    });
    for (const id of selected) await sdk.deployment(id).events.list();
    assert.equal(requests, selected.length + 1);
    assert.ok(!JSON.stringify(sdk).includes(credential));
    assert.ok(!inspect(sdk, { showHidden: true }).includes(credential));
  });

test("discovery pages preserve limits/options, stop at null and retain explicit continuation at cap", async () => {
  const cursors = [];
  const sdk = client(async (url, init) => {
    cursors.push(url.searchParams.get("cursor"));
    assert.equal(url.searchParams.get("limit"), "1");
    assert.equal(init.headers.get("x-request-id"), "pages");
    return json(
      cursors.length === 1
        ? { items: [item(ids[0])], nextCursor: ids[0] }
        : { items: [item(ids[1])], nextCursor: null },
    );
  });
  assert.equal(
    (await collect(sdk.deployments.pages({ limit: 1 }, { requestId: "pages" }))).length,
    2,
  );
  assert.deepEqual(cursors, [null, ids[0]]);
  let calls = 0;
  const capped = client(async () => {
    calls++;
    return json({ items: [item(ids[0])], nextCursor: ids[0] });
  });
  const result = await collect(capped.deployments.pages({}, { maxPages: 1 }));
  assert.equal(calls, 1);
  assert.equal(result[0].data.nextCursor, ids[0]);
  const empty = client(async () => json({ items: [], nextCursor: null }));
  assert.equal((await collect(empty.deployments.pages())).length, 1);
});

test("discovery inputs reject bad cursors, limits and page caps before fetch", async () => {
  const sdk = client(async () => {
    throw new Error("Must not fetch");
  });
  for (const query of [
    { cursor: "" },
    { cursor: "../../escape" },
    { cursor: token },
    ...[0, 101, 1.5, NaN, "1"].map((limit) => ({ limit })),
  ]) {
    assert.throws(() => sdk.deployments.list(query), TypeError);
    await assert.rejects(collect(sdk.deployments.pages(query)), TypeError);
  }
  for (const maxPages of [0, 10001, 1.5, NaN])
    await assert.rejects(collect(sdk.deployments.pages({}, { maxPages })), TypeError);
  const anonymous = new Paiflow({ baseUrl: "https://paiflow.example" });
  await assert.rejects(anonymous.deployments.list(), TypeError);
});

for (const data of [
  null,
  {},
  { items: [], nextCursor: "bad" },
  { items: [] },
  { items: {}, nextCursor: null },
  { items: Array.from({ length: 101 }, () => item(ids[0])), nextCursor: null },
  ...[{ id: "bad" }, { flowName: null }, { network: "future" }].map((change) => ({
    items: [{ ...item(ids[0]), ...change }],
    nextCursor: null,
  })),
])
  test("discovery validates unknown response fields", async () => {
    await assert.rejects(
      client(async () => json(data)).deployments.list(),
      PaiflowMalformedResponseError,
    );
  });

for (const next of [ids[1], ids[0], ids[1].toUpperCase()])
  test("discovery pages reject repeated/backward cursors before yielding", async () => {
    const sdk = client(async () =>
      json({ items: [], nextCursor: next }, { "x-request-id": "bad-page" }),
    );
    await assert.rejects(
      collect(sdk.deployments.pages({ cursor: ids[1] })),
      (error) =>
        error instanceof PaiflowMalformedResponseError && error.metadata.requestId === "bad-page",
    );
  });

test("discovery pages reject multi-page cycles and abort between pages", async () => {
  let calls = 0;
  const sdk = client(async () => json({ items: [], nextCursor: ids[calls++ === 0 ? 1 : 0] }));
  const iterator = sdk.deployments.pages();
  await iterator.next();
  await assert.rejects(iterator.next(), PaiflowMalformedResponseError);
  assert.equal(calls, 2);
  const controller = new AbortController();
  const interrupted = sdk.deployments.pages({}, { signal: controller.signal });
  await interrupted.next();
  const beforeAbort = calls;
  controller.abort();
  await assert.rejects(interrupted.next(), PaiflowAbortError);
  assert.equal(calls, beforeAbort);
});

test("discovery preserves timeout and cancellation without retries", async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return new Promise(() => {});
  });
  await assert.rejects(sdk.deployments.list({}, { timeoutMs: 5 }), PaiflowTimeoutError);
  const controller = new AbortController();
  const pending = sdk.deployments.list({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, PaiflowAbortError);
  assert.equal(calls, 2);
});

test("server selection and read-only refusals remain actionable and redact credentials", async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: calls === 1 ? "UNAUTHENTICATED" : "FORBIDDEN",
          message: `Refused ${token} ${other}`,
          fields: { selection: [`Refused ${other}`] },
          details: { safe: "retain", nested: { [token]: [token, other] } },
        },
      }),
      { status: calls === 1 ? 401 : 403, headers: { "retry-after": "3", "x-request-id": token } },
    );
  });
  for (const request of [
    () => sdk.deployment(ids[2]).events.list(),
    () => sdk.deployment(ids[0]).releaseEarly(),
  ])
    await assert.rejects(request(), (error) => {
      assert.ok(error instanceof PaiflowApiError);
      assert.equal(error.status, calls === 1 ? 401 : 403);
      assert.equal(error.code, calls === 1 ? "UNAUTHENTICATED" : "FORBIDDEN");
      assert.equal(error.details.safe, "retain");
      assert.equal(error.metadata.retryAfter, "3");
      const rendered = `${error.stack} ${JSON.stringify(error)}`;
      assert.ok(!rendered.includes(token));
      assert.ok(!rendered.includes(other));
      return true;
    });
  assert.equal(calls, 2);
});

test("strict developer format and legacy rejection preserve pfk compatibility", () => {
  for (const credential of [
    "pkdev_test",
    "pfd_test",
    `pfd_${"A".repeat(64)}`,
    `${token}a`,
    token.slice(0, -1),
    `${token}\n`,
  ])
    assert.throws(() => client(async () => {}, credential), TypeError);
  client(async () => {}, token);
  client(async () => {}, "pfk_legacy-TEST_1");
});

test("bearer allowlist adds only GET discovery and keeps owner, public and creation paths closed", async () => {
  let calls = 0;
  const transport = new PaiflowTransport({
    baseUrl: "https://paiflow.example",
    token,
    fetch: async () => {
      calls++;
      return json(true);
    },
  });
  for (const path of [
    "/api/v1/deployments/",
    "/api/v1/deployments-extra",
    "/api/developer-tokens",
    "/api/v1/demo-token",
    "/api/v1/openapi.json",
    "/api/flows",
    "/api/deployments/prepare",
  ])
    await assert.rejects(
      transport.request({ path, method: "GET", auth: { kind: "token" }, parse: (v) => v }),
      TypeError,
    );
  await assert.rejects(
    transport.request({
      path: "/api/v1/deployments",
      method: "POST",
      auth: { kind: "token" },
      parse: (v) => v,
    }),
    TypeError,
  );
  assert.equal(calls, 0);
});

test("public, demo, embed/SSE and webhook methods never inherit developer bearer", async () => {
  const visited = [];
  const sdk = client(async (url, init) => {
    visited.push(url.pathname);
    assert.equal(init.headers.get("authorization"), null);
    assert.ok(!url.href.includes(token));
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    if (url.pathname.endsWith("embed/events"))
      return new Response("event: connected\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream", "x-request-id": other },
      });
    if (url.pathname.includes("webhooks"))
      assert.equal(init.headers.get("x-webhook-secret"), "separate");
    return new Response(
      JSON.stringify({ error: { code: "DISABLED", message: `Unavailable ${token}` } }),
      { status: 403 },
    );
  });
  const deployment = sdk.deployment(ids[0]);
  for (const request of [
    () => sdk.getOpenApi(),
    () => sdk.createDemoToken(),
    () => deployment.embed.activity(),
    () => deployment.publicSchedule.get(),
    () => deployment.publicPayment.status("a".repeat(64)),
    () => deployment.subscription.allowance.get(),
    () =>
      deployment.webhook.trigger(
        { escrow: true },
        { webhookSecret: "separate", idempotencyKey: "persisted" },
      ),
  ])
    await assert.rejects(
      request(),
      (error) => error instanceof PaiflowApiError && !error.message.includes(token),
    );
  const stream = await collect(deployment.embed.stream());
  assert.equal(stream[0].metadata.requestId, "[redacted]");
  assert.equal(visited.length, 8);
});
