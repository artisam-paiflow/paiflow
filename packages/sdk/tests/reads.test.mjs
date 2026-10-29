import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Paiflow,
  PaiflowMalformedResponseError,
  PaiflowAbortError,
  PaiflowTimeoutError,
  PaiflowApiError,
} from "../dist/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const txHash = "a".repeat(64);
const time = "2026-10-13T01:02:03.000Z";
// Valid StrKey contract (zero payload with CRC16-XModem).
const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const event = {
  id,
  eventId: "000123-event",
  kind: "PAYOUT",
  topic: "swap",
  ledger: 123,
  txHash,
  occurredAt: time,
  data: { amount: "9007199254740993" },
};
const publicEvent = {
  eventId: event.eventId,
  kind: event.kind,
  ledger: event.ledger,
  txHash,
  occurredAt: time,
  amountStroops: "9007199254740993",
};
const json = (data, headers = {}) => new Response(JSON.stringify({ data }), { headers });
const setup = (fetch) =>
  new Paiflow({ baseUrl: "https://paiflow.example", token: "pfk_test", fetch });
const op = {
  status: "conditional",
  authentication: "deployment_token",
  requirements: ["wallet consent"],
  nodeIds: ["node"],
};
const capabilities = {
  deploymentId: id,
  network: "testnet",
  configurationSource: "deployment_snapshot",
  triggerType: "deposit",
  inputAsset: { kind: "native" },
  operations: Object.fromEntries(
    [
      "execute",
      "events",
      "balances",
      "funding",
      "transactions",
      "releaseEarly",
      "webhook",
      "subscriptionAllowance",
      "subscriptionState",
      "subscriptionCancel",
      "subscriptionReactivate",
      "swapQuote",
      "scheduleState",
      "scheduleControls",
    ].map((key) => [key, op]),
  ),
};
const balances = {
  deploymentId: id,
  network: "testnet",
  totals: [{ tokenContract: contract, balanceStroops: "9007199254740993" }],
  nodes: [
    {
      nodeId: "node",
      templateKind: "SWAPPER",
      contractAddress: contract,
      tokenContract: null,
      balanceStroops: null,
      readAt: null,
      stale: true,
      error: "Unavailable",
    },
  ],
  freshness: { status: "partial", totalsComplete: false, attemptedAt: time, cached: true },
};
const quote = {
  deploymentId: id,
  network: "testnet",
  nodeId: "swap",
  contractAddress: contract,
  assetInContractAddress: contract,
  assetOutContractAddress: contract,
  routerAddress: contract,
  pairAddress: contract,
  amountInStroops: "9007199254740993",
  amountOutStroops: "2",
  amountOutMinStroops: "0",
  slippageBps: 100,
  readStartedAt: time,
  quotedAt: time,
  freshness: "live",
  estimate: true,
  scope: "selected_node",
  meetsMinimumAtQuote: false,
};
for (const [name, fixture, call, path] of [
  ["capabilities", capabilities, (d) => d.capabilities.get(), "capabilities"],
  ["balances", balances, (d) => d.balances.get(), "balances"],
  [
    "quote",
    quote,
    (d) => d.swap.quote({ amountStroops: "9007199254740993", nodeId: "swap" }),
    "swap-quote",
  ],
  [
    "events",
    { items: [event], nextCursor: "opaque", hasMore: false },
    (d) => d.events.list({ txHash: txHash.toUpperCase(), limit: 5 }),
    "events",
  ],
])
  test(`${name} uses token route and retains protocol fields and metadata`, async () => {
    const client = setup(async (url, init) => {
      assert.equal(url.pathname, `/api/v1/deployments/${id}/${path}`);
      assert.equal(init.headers.get("authorization"), "Bearer pfk_test");
      if (name === "quote") assert.equal(url.searchParams.get("amountStroops"), "9007199254740993");
      if (name === "events") assert.equal(url.searchParams.get("txHash"), txHash);
      return json({ ...fixture, futureServerField: "accepted" }, { "x-request-id": "read-1" });
    });
    const response = await call(client.deployment(id));
    assert.deepEqual(response.data, fixture);
    assert.equal(response.metadata.requestId, "read-1");
  });
for (const status of ["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"])
  test(`transaction retains ${status}`, async () => {
    const response = await setup(async (url) => {
      assert.equal(url.pathname, `/api/v1/deployments/${id}/transactions/${txHash}`);
      return json({ txHash, network: "testnet", status });
    })
      .deployment(id)
      .transactions.get(txHash.toUpperCase());
    assert.equal(response.data.status, status);
  });
for (const [name, fixture, call] of [
  ["numeric money", { ...quote, amountInStroops: 1 }, (d) => d.swap.quote({ amountStroops: "1" })],
  [
    "bad checksum",
    { ...balances, totals: [{ tokenContract: contract.slice(0, -1) + "A", balanceStroops: "1" }] },
    (d) => d.balances.get(),
  ],
  ["missing freshness", { ...balances, freshness: undefined }, (d) => d.balances.get()],
  [
    "fictional readiness",
    {
      ...capabilities,
      operations: { ...capabilities.operations, execute: { ...op, status: "ready" } },
    },
    (d) => d.capabilities.get(),
  ],
  [
    "unknown tx status",
    { txHash, network: "testnet", status: "NOT_FOUND" },
    (d) => d.transactions.get(txHash),
  ],
  [
    "missing data",
    { items: [{ ...event, data: undefined }], nextCursor: null, hasMore: false },
    (d) => d.events.list(),
  ],
])
  test(`rejects malformed ${name}`, async () => {
    await assert.rejects(
      call(setup(async () => json(fixture)).deployment(id)),
      PaiflowMalformedResponseError,
    );
  });
test("input validation rejects float/zero/oversized quote, cursor and limit before fetching", async () => {
  let calls = 0;
  const d = setup(async () => {
    calls++;
    return json(null);
  }).deployment(id);
  for (const amountStroops of ["1.5", "0", "9".repeat(40), 1, (1n << 127n).toString()])
    assert.throws(() => d.swap.quote({ amountStroops }), TypeError);
  for (const query of [
    { cursor: "" },
    { cursor: "x".repeat(513) },
    { limit: 0 },
    { limit: 101 },
    { txHash: "bad" },
  ])
    assert.throws(() => d.events.list(query), TypeError);
  assert.throws(() => setup(() => {}).deployment("../escape"), TypeError);
  assert.equal(calls, 0);
});
test("bounded pages preserve filters, deduplicate eventId, retain empty tail cursor", async () => {
  const queries = [];
  const fixtures = [
    { items: [event], nextCursor: "first", hasMore: true },
    { items: [event, { ...event, eventId: "second" }], nextCursor: "second", hasMore: true },
    { items: [], nextCursor: "second", hasMore: false },
  ];
  const d = setup(async (url) => {
    queries.push(Object.fromEntries(url.searchParams));
    return json(fixtures.shift());
  }).deployment(id);
  const pages = [];
  for await (const response of d.events.pages({ limit: 5, txHash, cursor: "start" }))
    pages.push(response.data);
  assert.deepEqual(
    queries,
    ["start", "first", "second"].map((cursor) => ({ cursor, limit: "5", txHash })),
  );
  assert.deepEqual(
    pages.map((p) => p.items.length),
    [1, 1, 0],
  );
  assert.equal(pages[2].nextCursor, "second");
});
for (const cursor of [null, "start"])
  test(`rejects nonadvancing pagination ${cursor}`, async () => {
    const d = setup(async () => json({ items: [], nextCursor: cursor, hasMore: true })).deployment(
      id,
    );
    await assert.rejects(async () => {
      for await (const page of d.events.pages({ cursor: "start" })) void page;
    }, PaiflowMalformedResponseError);
  });
test("page cap stops requests and exposes cursor for explicit continuation", async () => {
  let calls = 0;
  const d = setup(async () =>
    json({ items: [], nextCursor: `cursor${++calls}`, hasMore: true }),
  ).deployment(id);
  const pages = [];
  for await (const page of d.events.pages({}, { maxPages: 2 })) pages.push(page);
  assert.equal(calls, 2);
  assert.equal(pages[1].data.nextCursor, "cursor2");
});
test("pages stop on caller cancellation between pages", async () => {
  const controller = new AbortController();
  let calls = 0;
  const iterator = setup(async () => {
    calls++;
    return json({ items: [], nextCursor: "next", hasMore: true });
  })
    .deployment(id)
    .events.pages({}, { signal: controller.signal });
  await iterator.next();
  controller.abort();
  await assert.rejects(iterator.next(), PaiflowAbortError);
  assert.equal(calls, 1);
});
test("public utilities never send deployment tokens or create demo tokens implicitly", async () => {
  const paths = [];
  const client = setup(async (url, init) => {
    paths.push(url.pathname);
    assert.equal(init.headers.get("authorization"), null);
    if (url.pathname.endsWith("openapi.json"))
      return new Response(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "Paiflow", version: "1" },
          paths: {},
          future: true,
        }),
      );
    if (url.pathname.endsWith("demo-token")) {
      assert.equal(init.method, "POST");
      return json({ deploymentId: id, token: `pfk_${"a".repeat(64)}`, expiresAt: time });
    }
    if (url.pathname.endsWith("activity")) return json({ events: [publicEvent, publicEvent] });
    return json({ paused: true, available: "9007199254740993", retrieveAllowed: false });
  });
  const d = client.deployment(id);
  assert.equal(paths.length, 0);
  assert.equal((await client.getOpenApi()).data.future, true);
  assert.equal((await d.publicSchedule.get()).data.available, "9007199254740993");
  assert.equal((await d.embed.activity()).data.events.length, 1);
  assert.equal(paths.length, 3);
  assert.equal((await client.createDemoToken()).data.deploymentId, id);
  assert.equal(
    d.urls.payment({ amount: "1.2345678" }),
    `https://paiflow.example/trigger/${id}?amount=1.2345678`,
  );
  assert.equal(d.urls.allowance(), `https://paiflow.example/allowance/${id}`);
  assert.equal(d.urls.embed(), `https://paiflow.example/deployments/${id}/embed`);
  assert.throws(() => d.urls.payment({ amount: "1e7" }), TypeError);
  assert.equal(paths.length, 4);
});
const encode = new TextEncoder();
const sse = (chunks) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks)
          c.enqueue(typeof chunk === "string" ? encode.encode(chunk) : chunk);
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const collect = async (iterator) => {
  const output = [];
  for await (const item of iterator) output.push(item);
  return output;
};
test("SSE parses chunked CRLF/multiline Unicode messages, heartbeats and explicit reconnect", async () => {
  let calls = 0;
  const body = `retry: 10000\r\nevent: connected\r\ndata: {}\r\n\r\n: ping\n\nevent: snapshot\ndata: {"events":\ndata: ${JSON.stringify(
    [
      { ...publicEvent, kind: "páy" },
      { ...publicEvent, kind: "páy" },
    ],
  )}}\n\n`;
  const bytes = encode.encode(body);
  const d = setup(async (url, init) => {
    calls++;
    assert.equal(init.headers.get("authorization"), null);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    return sse([...bytes].map((value) => Uint8Array.of(value)));
  }).deployment(id);
  const output = await collect(d.embed.stream());
  assert.deepEqual(output[0].data, { event: "connected" });
  assert.equal(output[1].data.snapshot.events.length, 1);
  assert.equal(output[1].data.snapshot.events[0].kind, "páy");
  assert.equal(calls, 1);
  await collect(d.embed.stream());
  assert.equal(calls, 2);
});
for (const [name, chunks] of [
  ["invalid JSON", ["event: snapshot\ndata: nope\n\n"]],
  [
    "private owner shape",
    [`event: snapshot\ndata: ${JSON.stringify({ events: [{ id, payload: {} }] })}\n\n`],
  ],
  [
    "over 50 events",
    [`event: snapshot\ndata: ${JSON.stringify({ events: Array(51).fill(publicEvent) })}\n\n`],
  ],
  ["oversized line", ["x".repeat(262145)]],
  ["oversized frame", ["data: " + "x".repeat(200000) + "\n", "data: " + "y".repeat(70000) + "\n"]],
  ["invalid UTF8", [Uint8Array.of(255)]],
])
  test(`SSE rejects ${name}`, async () => {
    await assert.rejects(
      collect(
        setup(async () => sse(chunks))
          .deployment(id)
          .embed.stream(),
      ),
      PaiflowMalformedResponseError,
    );
  });
test("SSE ignores unknown events and discards truncated frames", async () => {
  const output = await collect(
    setup(async () => sse(["event: future\ndata: nope\n\nevent: connected\ndata: {}"]))
      .deployment(id)
      .embed.stream(),
  );
  assert.deepEqual(output, []);
});
test("SSE parses CR-only message boundaries including trailing CR", async () => {
  const output = await collect(
    setup(async () => sse(["event: connected\rdata: {}\r\r"]))
      .deployment(id)
      .embed.stream(),
  );
  assert.deepEqual(output[0].data, { event: "connected" });
});
test("SSE keeps plain-text 503 metadata without body disclosure or retry", async () => {
  let calls = 0;
  await assert.rejects(
    collect(
      setup(async () => {
        calls++;
        return new Response("sensitive body", { status: 503, headers: { "retry-after": "15" } });
      })
        .deployment(id)
        .embed.stream(),
    ),
    (error) =>
      error instanceof PaiflowApiError &&
      error.status === 503 &&
      error.metadata.retryAfter === "15" &&
      !error.message.includes("sensitive"),
  );
  assert.equal(calls, 1);
});
test("SSE cancellation releases body reader and stops an idle read", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const iterator = setup(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encode.encode("event: connected\ndata: {}\n\n"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  )
    .deployment(id)
    .embed.stream({ signal: controller.signal });
  await iterator.next();
  const next = iterator.next();
  controller.abort();
  await assert.rejects(next, PaiflowAbortError);
  assert.equal(cancelled, true);
});
test("breaking SSE iteration cancels the connection", async () => {
  let cancelled = false;
  const d = setup(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encode.encode("event: connected\ndata: {}\n\n"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  ).deployment(id);
  for await (const message of d.embed.stream()) {
    assert.equal(message.data.event, "connected");
    break;
  }
  assert.equal(cancelled, true);
});
test("SSE timeout also bounds fetch implementations that ignore AbortSignal", async () => {
  const iterator = setup(() => new Promise(() => {}))
    .deployment(id)
    .embed.stream({ timeoutMs: 10 });
  await assert.rejects(iterator.next(), PaiflowTimeoutError);
});
test("new reads enforce response size bounds", async () => {
  await assert.rejects(
    setup(async () => new Response("x".repeat(4194305)))
      .deployment(id)
      .balances.get(),
    PaiflowMalformedResponseError,
  );
});
test("StrKey parser agrees with Stellar SDK for generated C/G addresses and corrupt checksums", async () => {
  // Development-only parity oracle, never imported by SDK runtime or package artifact.
  const { StrKey } = await import("@stellar/stellar-sdk");
  for (const bytes of [
    new Uint8Array(32),
    new Uint8Array(32).fill(255),
    ...[0, 1, 31, 127, 255].map((seed) =>
      Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 17) & 255),
    ),
  ]) {
    const c = StrKey.encodeContract(Buffer.from(bytes));
    const g = StrKey.encodeEd25519PublicKey(Buffer.from(bytes));
    assert.ok(StrKey.isValidContract(c));
    assert.ok(StrKey.isValidEd25519PublicKey(g));
    const custom = { ...capabilities, inputAsset: { kind: "custom", code: "TOKEN", issuer: g } };
    assert.equal(
      (
        await setup(async () => json(custom))
          .deployment(id)
          .capabilities.get()
      ).data.inputAsset.issuer,
      g,
    );
    const value = { ...balances, totals: [{ tokenContract: c, balanceStroops: "1" }] };
    assert.equal(
      (
        await setup(async () => json(value))
          .deployment(id)
          .balances.get()
      ).data.totals[0].tokenContract,
      c,
    );
    for (const [fixture, field] of [
      [custom, "issuer"],
      [value, "tokenContract"],
    ]) {
      const corrupted = structuredClone(fixture);
      const original =
        field === "issuer" ? corrupted.inputAsset.issuer : corrupted.totals[0].tokenContract;
      const bad = original.slice(0, -1) + (original.endsWith("A") ? "B" : "A");
      if (field === "issuer") corrupted.inputAsset.issuer = bad;
      else corrupted.totals[0].tokenContract = bad;
      assert.equal(
        field === "issuer" ? StrKey.isValidEd25519PublicKey(bad) : StrKey.isValidContract(bad),
        false,
      );
      const d = setup(async () => json(corrupted)).deployment(id);
      await assert.rejects(
        field === "issuer" ? d.capabilities.get() : d.balances.get(),
        PaiflowMalformedResponseError,
      );
    }
  }
});
test("SSE rejects redirected/foreign response origins and wrong content type", async () => {
  for (const key of ["redirected", "url"]) {
    const response = sse(["event: connected\ndata: {}\n\n"]);
    Object.defineProperty(response, key, {
      value: key === "url" ? "https://foreign.example/api/events" : true,
    });
    await assert.rejects(
      collect(
        setup(async () => response)
          .deployment(id)
          .embed.stream(),
      ),
      /Unexpected response origin/,
    );
  }
  await assert.rejects(
    collect(
      setup(async () => new Response("{}", { headers: { "content-type": "application/json" } }))
        .deployment(id)
        .embed.stream(),
    ),
    PaiflowMalformedResponseError,
  );
});
test("public utility parsers reject numeric money, invalid tokens, malformed document and invalid dates", async () => {
  await assert.rejects(
    setup(async () => json({ paused: true, available: 1, retrieveAllowed: true }))
      .deployment(id)
      .publicSchedule.get(),
    PaiflowMalformedResponseError,
  );
  await assert.rejects(
    setup(async () =>
      json({ deploymentId: id, token: "not-a-token", expiresAt: time }),
    ).createDemoToken(),
    PaiflowMalformedResponseError,
  );
  await assert.rejects(
    setup(async () => new Response(JSON.stringify({ openapi: "3.1.0", paths: {} }))).getOpenApi(),
    PaiflowMalformedResponseError,
  );
  await assert.rejects(
    setup(async () => json({ events: [{ ...publicEvent, occurredAt: "2026-02-31T00:00:00Z" }] }))
      .deployment(id)
      .embed.activity(),
    PaiflowMalformedResponseError,
  );
});
