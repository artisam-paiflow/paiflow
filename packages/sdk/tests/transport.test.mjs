import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PaiflowTransport,
  PaiflowApiError,
  PaiflowMalformedResponseError,
  PaiflowAbortError,
  PaiflowTimeoutError,
  PaiflowTransportError,
} from "../dist/index.js";
const request = {
  path: "/api/v1/deployments/id/balances",
  method: "GET",
  auth: { kind: "token" },
  parse: (value) => value,
};
const client = (fetch) =>
  new PaiflowTransport({ baseUrl: "https://paiflow.example", token: "pfk_test", fetch });
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
test("unwraps once and preserves financial state, additive fields and metadata", async () => {
  const sdk = client(async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.get("authorization"), "Bearer pfk_test");
    assert.equal(
      init.headers.get("x-preparation-request-id"),
      "11111111-1111-4111-8111-111111111111",
    );
    return json({ data: { status: "PENDING", future: true } }, 202, {
      "x-request-id": "caller",
      "x-history-request-id": "history",
      "retry-after": "10",
    });
  });
  assert.deepEqual(
    await sdk.request(request, { preparationRequestId: "11111111-1111-4111-8111-111111111111" }),
    {
      data: { status: "PENDING", future: true },
      metadata: { status: 202, requestId: "caller", historyRequestId: "history", retryAfter: "10" },
    },
  );
});
test("public and webhook requests do not inherit token", async () => {
  const sdk = client(async (_, init) => {
    assert.equal(init.headers.get("authorization"), null);
    return json({ data: true });
  });
  await sdk.request({ ...request, auth: { kind: "public" } });
  await sdk.request({
    ...request,
    path: "/api/webhooks/id",
    auth: { kind: "webhook", secret: "separate" },
  });
});
for (const status of [401, 422, 429])
  test(`API error ${status} preserves safe fields and unknown codes`, async () => {
    const sdk = client(async () =>
      json(
        {
          error: {
            code: "FUTURE_ERROR",
            message: "Invalid pfk_test",
            fields: { amount: ["Too small"] },
            details: { signedXdr: "secret", safe: true },
          },
        },
        status,
        { "retry-after": "3" },
      ),
    );
    await assert.rejects(
      sdk.request(request),
      (error) =>
        error instanceof PaiflowApiError &&
        error.status === status &&
        error.code === "FUTURE_ERROR" &&
        error.message === "Invalid [redacted]" &&
        error.details.signedXdr === "[redacted]" &&
        error.fields.amount[0] === "Too small" &&
        error.metadata.retryAfter === "3",
    );
  });
test("malformed JSON, missing envelope and parser failure are distinct", async () => {
  for (const response of [new Response("invalid"), json({ other: 1 }), json({ data: 1 })]) {
    await assert.rejects(
      client(async () => response).request({
        ...request,
        parse: () => {
          throw new Error("sensitive");
        },
      }),
      PaiflowMalformedResponseError,
    );
  }
  await assert.rejects(
    client(async () => new Response("proxy body", { status: 503 })).request(request),
    (error) =>
      error instanceof PaiflowApiError &&
      error.code === "HTTP_ERROR" &&
      !error.message.includes("proxy"),
  );
});
test("raw response parser and no mutation retries", async () => {
  let calls = 0;
  await assert.rejects(
    client(async () => {
      calls++;
      throw new Error("pfk_test network");
    }).request({ ...request, method: "POST", body: { signedXdr: "private" } }),
    (error) => error instanceof PaiflowTransportError && !error.message.includes("pfk_test"),
  );
  assert.equal(calls, 1);
  assert.equal(
    (await client(async () => json({ openapi: "3" })).request({ ...request, raw: true })).data
      .openapi,
    "3",
  );
});
test("rejects credential URLs, path escape, redirects and foreign origins", async () => {
  for (const baseUrl of [
    "http://external.example",
    "https://user:pass@example.com",
    "https://example.com/api",
    "https://example.com?token=a",
  ])
    assert.throws(() => new PaiflowTransport({ baseUrl }));
  new PaiflowTransport({ baseUrl: "http://localhost:3000" });
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return json({ data: true });
  });
  for (const path of [
    "//evil.example/api",
    "/api/../secret",
    "/api/%2fsecret",
    "https://evil.example/api",
  ])
    await assert.rejects(sdk.request({ ...request, path }), TypeError);
  await assert.rejects(sdk.request({ ...request, query: { token: "private" } }), TypeError);
  assert.equal(calls, 0);
  const response = json({ data: true });
  Object.defineProperty(response, "url", { value: "https://evil.example/api" });
  await assert.rejects(client(async () => response).request(request), PaiflowTransportError);
});
test("abort before fetch, during fetch and stalled response body", async () => {
  const before = new AbortController();
  before.abort("private reason");
  let calls = 0;
  await assert.rejects(
    client(async () => {
      calls++;
      return json({ data: true });
    }).request(request, { signal: before.signal }),
    PaiflowAbortError,
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = client(async () => new Promise(() => {})).request(request, {
    signal: during.signal,
  });
  during.abort();
  await assert.rejects(pending, PaiflowAbortError);
  await assert.rejects(
    client(async () => new Promise(() => {})).request(request, { timeoutMs: 5 }),
    PaiflowTimeoutError,
  );
  const body = new Response(new ReadableStream({ start() {} }));
  await assert.rejects(
    client(async () => body).request(request, { timeoutMs: 5 }),
    PaiflowTimeoutError,
  );
});

test("keeps nonsecret control intent and transaction identifiers in conflicts", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const sdk = client(async () =>
    json(
      {
        error: {
          code: "CONFLICT",
          message: "Reserved",
          details: {
            controlIntentId: id,
            txHash: "a".repeat(64),
            nodeId: "schedule-1",
            intent: "opaque-sensitive",
          },
        },
      },
      409,
    ),
  );
  await assert.rejects(
    sdk.request({ ...request, method: "POST", body: { intentId: id } }),
    (error) =>
      error.details.controlIntentId === id &&
      error.details.txHash === "a".repeat(64) &&
      error.details.nodeId === "schedule-1" &&
      error.details.intent === "[redacted]",
  );
});
test("credentials are confined to their route families", async () => {
  const sdk = client(async () => {
    throw new Error("Must not fetch");
  });
  await assert.rejects(sdk.request({ ...request, path: "/api/auth/login" }), TypeError);
  await assert.rejects(
    sdk.request({ ...request, auth: { kind: "webhook", secret: "secret" } }),
    TypeError,
  );
});

test("native fetch never forwards credentials to redirected origins", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  let destinationCalls = 0;
  const destination = createServer((_, response) => {
    destinationCalls++;
    response.end("{}");
  });
  destination.listen(0, "127.0.0.1");
  await once(destination, "listening");
  const source = createServer((incoming, response) => {
    assert.equal(incoming.headers.authorization, "Bearer pfk_test");
    response.writeHead(302, {
      location: `http://127.0.0.1:${destination.address().port}/api/other`,
    });
    response.end();
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  try {
    const sdk = new PaiflowTransport({
      baseUrl: `http://127.0.0.1:${source.address().port}`,
      token: "pfk_test",
    });
    await assert.rejects(sdk.request(request), PaiflowTransportError);
    assert.equal(destinationCalls, 0);
  } finally {
    source.closeAllConnections();
    destination.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => source.close(resolve)),
      new Promise((resolve) => destination.close(resolve)),
    ]);
  }
});
test("body cancellation releases stream reader and aborts fetch signal", async () => {
  let cancelled = false;
  let signal;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const sdk = client(async (_, init) => {
    signal = init.signal;
    return new Response(stream);
  });
  await assert.rejects(sdk.request(request, { timeoutMs: 5 }), PaiflowTimeoutError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
  assert.equal(stream.locked, false);
});
