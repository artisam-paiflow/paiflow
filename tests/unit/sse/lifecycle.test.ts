import { EventEmitter } from "node:events";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscriber: null as unknown,
  session: vi.fn(),
  deployment: vi.fn(),
  poll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/redis", () => ({
  redisSub: () => mocks.subscriber,
  eventChannel: (id: string) => `events:${id}`,
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.deployment } } }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: mocks.poll }));

class Subscriber extends EventEmitter {
  status = "ready";
  subscribe = vi.fn<(channel: string) => Promise<number>>().mockResolvedValue(1);
  unsubscribe = vi.fn<(channel: string) => Promise<number>>().mockResolvedValue(0);
  disconnect = vi.fn((reconnect = false) => {
    this.status = reconnect ? "reconnecting" : "end";
    this.emit("close");
  });
}
function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<number>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const viewer = () => ({ ready: vi.fn(), message: vi.fn(), close: vi.fn() });
const globals = globalThis as typeof globalThis & {
  paiflowShutdown?: unknown;
  paiflowEventStreams?: unknown;
};
let sub: Subscriber;
let manager: import("@/lib/deployment-event-streams").DeploymentEventStreams;
let shutdown: typeof import("@/lib/server-shutdown");
let response: typeof import("@/lib/deployment-event-response").deploymentEventResponse;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  delete globals.paiflowShutdown;
  delete globals.paiflowEventStreams;
  sub = new Subscriber();
  mocks.subscriber = sub;
  shutdown = await import("@/lib/server-shutdown");
  const streams = await import("@/lib/deployment-event-streams");
  manager = streams.deploymentEventStreams()!;
  response = (await import("@/lib/deployment-event-response")).deploymentEventResponse;
});
afterEach(() => {
  manager.shutdown();
  process.off("SIGTERM", shutdown.beginServerShutdown);
  process.off("SIGINT", shutdown.beginServerShutdown);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

function open(id = "a", controller = new AbortController()) {
  const res = response(id, controller.signal, mocks.poll);
  return { res, reader: res.body!.getReader(), controller };
}
const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);

it("shares one subscription, keeps the remaining viewer connected, and isolates deployments", async () => {
  const a = viewer(),
    b = viewer(),
    other = viewer();
  const leaveA = manager.join("a", a),
    leaveB = manager.join("a", b);
  const leaveOther = manager.join("b", other);
  await flush();
  expect(sub.subscribe.mock.calls).toEqual([["a"], ["b"]]);
  sub.emit("message", "a", "first");
  expect(a.message).toHaveBeenCalledWith("first");
  expect(b.message).toHaveBeenCalledWith("first");
  expect(other.message).not.toHaveBeenCalled();
  leaveA();
  await flush();
  expect(sub.unsubscribe).not.toHaveBeenCalled();
  sub.emit("message", "a", "second");
  expect(a.message).toHaveBeenCalledTimes(1);
  expect(b.message).toHaveBeenCalledWith("second");
  leaveB();
  leaveOther();
  await flush();
  expect(sub.unsubscribe.mock.calls).toEqual([["a"], ["b"]]);
  expect(manager.counts).toEqual({ viewers: 0, channels: 0 });
});

it("reconciles a last departure while SUBSCRIBE is pending without resurrecting it", async () => {
  const pending = deferred();
  sub.subscribe.mockReturnValueOnce(pending.promise);
  const v = viewer(),
    release = manager.join("a", v);
  release();
  release();
  pending.resolve(1);
  await flush();
  expect(v.ready).not.toHaveBeenCalled();
  expect(sub.unsubscribe).toHaveBeenCalledWith("a");
  expect(manager.counts).toEqual({ viewers: 0, channels: 0 });
});

it("resubscribes a new viewer arriving while UNSUBSCRIBE is pending", async () => {
  const a = viewer(),
    release = manager.join("a", a);
  await flush();
  const pending = deferred();
  sub.unsubscribe.mockReturnValueOnce(pending.promise);
  release();
  const b = viewer(),
    leave = manager.join("a", b);
  expect(b.ready).not.toHaveBeenCalled();
  pending.resolve(0);
  await flush();
  expect(sub.subscribe).toHaveBeenCalledTimes(2);
  expect(b.ready).toHaveBeenCalledOnce();
  sub.emit("message", "a", "live");
  expect(b.message).toHaveBeenCalledWith("live");
  leave();
  await flush();
});

it("bounds Redis listeners under 100 simultaneous streams and 1,000 consumed connection cycles", async () => {
  const baseline = ["message", "error", "close", "ready"].map((e) => sub.listenerCount(e));
  const concurrent = Array.from({ length: 100 }, () => open());
  await flush();
  expect(manager.counts).toEqual({ channels: 1, viewers: 100 });
  for (const stream of concurrent) {
    await stream.reader.read();
    await stream.reader.cancel();
  }
  await flush();
  for (let i = 0; i < 1000; i++) {
    const stream = open();
    await flush();
    await stream.reader.read();
    stream.controller.abort();
    await flush();
  }
  expect(["message", "error", "close", "ready"].map((e) => sub.listenerCount(e))).toEqual(baseline);
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
});

it.each(["abort", "cancel"])("disposes an active stream on %s", async (method) => {
  const stream = open();
  await flush();
  expect(decode((await stream.reader.read()).value)).toBe(": ping\n\n");
  expect(decode((await stream.reader.read()).value)).toContain("event: connected");
  expect(mocks.poll).toHaveBeenCalledOnce();
  if (method === "abort") stream.controller.abort();
  else await stream.reader.cancel();
  await flush();
  expect((await stream.reader.read()).done).toBe(true);
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
});

it("does not register a request whose signal was already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = open("a", controller);
  expect((await stream.reader.read()).done).toBe(true);
  expect(sub.subscribe).not.toHaveBeenCalled();
});

it.each(["abort", "timeout", "shutdown"])(
  "cleans pending Redis readiness on %s",
  async (method) => {
    sub.status = "connecting";
    const stream = open();
    if (method === "abort") stream.controller.abort();
    if (method === "timeout") await vi.advanceTimersByTimeAsync(5000);
    if (method === "shutdown") shutdown.beginServerShutdown();
    sub.status = "ready";
    sub.emit("ready");
    await flush();
    expect((await stream.reader.read()).done).toBe(true);
    expect(sub.subscribe).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
  },
);

it.each(["abort", "shutdown"])(
  "ignores a late subscribe acknowledgement after %s",
  async (method) => {
    const pending = deferred();
    sub.subscribe.mockReturnValueOnce(pending.promise);
    const stream = open();
    if (method === "abort") stream.controller.abort();
    else shutdown.beginServerShutdown();
    pending.resolve(1);
    await flush();
    expect((await stream.reader.read()).done).toBe(true);
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
  },
);

it("closes a stream when subscription setup fails and permits Redis recovery", async () => {
  sub.subscribe.mockRejectedValueOnce(new Error("subscription failed"));
  const stream = open();
  await flush();
  expect((await stream.reader.read()).done).toBe(true);
  expect(sub.disconnect).toHaveBeenCalledWith(true);
  sub.status = "ready";
  sub.emit("ready");
  const replacement = open();
  await flush();
  expect(decode((await replacement.reader.read()).value)).toBe(": ping\n\n");
  await replacement.reader.cancel();
  await flush();
});

it.each(["error", "close"])(
  "disposes all active responses on Redis %s and reconnects cleanly",
  async (event) => {
    const a = open(),
      b = open("b");
    await flush();
    await a.reader.read();
    await a.reader.read();
    await b.reader.read();
    await b.reader.read();
    if (event === "close") sub.status = "reconnecting";
    sub.emit(event, new Error("socket failed"));
    await flush();
    expect((await a.reader.read()).done).toBe(true);
    expect((await b.reader.read()).done).toBe(true);
    expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
    sub.status = "ready";
    sub.emit("ready");
    const next = open();
    await flush();
    await next.reader.read();
    await next.reader.cancel();
    await flush();
  },
);

it("shuts down once, releases listeners, and rejects new streams", async () => {
  const a = open(),
    b = open();
  await flush();
  for (const s of [a, b]) {
    await s.reader.read();
    await s.reader.read();
  }
  shutdown.beginServerShutdown();
  shutdown.beginServerShutdown();
  expect((await a.reader.read()).done).toBe(true);
  expect((await b.reader.read()).done).toBe(true);
  expect(sub.disconnect).toHaveBeenCalledOnce();
  expect(sub.eventNames()).toEqual([]);
  expect(response("a", new AbortController().signal, mocks.poll).status).toBe(503);
});

it("prepends a single hook before Next's shutdown listener across bundled module loads", async () => {
  const order: string[] = [];
  const next = () => {
    order.push(shutdown.isShuttingDown() ? "drained" : "open");
  };
  process.on("SIGTERM", next);
  try {
    shutdown.installServerShutdown();
    shutdown.installServerShutdown();
    vi.resetModules();
    const secondBundle = await import("@/lib/server-shutdown");
    secondBundle.installServerShutdown();
    expect(
      process.listeners("SIGTERM").filter((fn) => fn === shutdown.beginServerShutdown),
    ).toHaveLength(1);
    process.emit("SIGTERM");
    expect(order).toEqual(["drained"]);
    expect(secondBundle.isShuttingDown()).toBe(true);
  } finally {
    process.off("SIGTERM", next);
  }
});

it("continues other shutdown callbacks if one fails", () => {
  const callback = vi.fn();
  shutdown.onServerShutdown(() => {
    throw new Error("failed cleanup");
  });
  shutdown.onServerShutdown(callback);
  shutdown.beginServerShutdown();
  expect(callback).toHaveBeenCalledOnce();
});

it("ignores malformed messages and releases registration after a failed write", async () => {
  const enqueue = vi.spyOn(ReadableStreamDefaultController.prototype, "enqueue");
  const stream = open();
  await flush();
  await stream.reader.read();
  await stream.reader.read();
  sub.emit("message", "events:a", "bad-json");
  enqueue.mockImplementationOnce(() => {
    throw new Error("closed writer");
  });
  sub.emit("message", "events:a", '{"kind":"PAYOUT"}');
  await flush();
  expect((await stream.reader.read()).done).toBe(true);
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
  enqueue.mockRestore();
});

it("retains owner authentication and deployment ownership before stream registration", async () => {
  const { GET } = await import("@/app/api/deployments/[id]/events/route");
  const req = new Request("http://localhost/api/deployments/a/events") as NextRequest;
  const ctx = { params: Promise.resolve({ id: "a" }) };
  mocks.session.mockRejectedValueOnce(new Error("unauthenticated"));
  expect((await GET(req, ctx)).status).toBe(401);
  expect(mocks.deployment).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ id: "owner" });
  mocks.deployment.mockResolvedValue(null);
  await expect(GET(req, ctx)).rejects.toThrow("Deployment not found");
  expect(mocks.deployment).toHaveBeenCalledWith({
    where: { id: "a", ownerId: "owner" },
    select: { id: true },
  });
  expect(sub.subscribe).not.toHaveBeenCalled();
});

it("bounds a missing subscription acknowledgement and ignores it after recovery", async () => {
  const pending = deferred();
  sub.subscribe.mockReturnValueOnce(pending.promise);
  const stream = open();
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  expect((await stream.reader.read()).done).toBe(true);
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
  expect(sub.disconnect).toHaveBeenCalledWith(true);
  sub.status = "ready";
  sub.emit("ready");
  const replacement = open();
  await flush();
  pending.resolve(1);
  await flush();
  expect(manager.counts).toEqual({ channels: 1, viewers: 1 });
  await replacement.reader.read();
  await replacement.reader.cancel();
  await flush();
});

it("shuts down during unsubscribe without admitting a successor", async () => {
  const stream = open();
  await flush();
  const pending = deferred();
  sub.unsubscribe.mockReturnValueOnce(pending.promise);
  await stream.reader.cancel();
  shutdown.beginServerShutdown();
  expect(vi.getTimerCount()).toBe(0);
  expect(response("a", new AbortController().signal, mocks.poll).status).toBe(503);
  pending.resolve(0);
  await flush();
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
});

it("closes other streams and reconnects when unsubscribe fails", async () => {
  const a = open(),
    b = open("b");
  await flush();
  await b.reader.read();
  await b.reader.read();
  sub.unsubscribe.mockRejectedValueOnce(new Error("unsubscribe failed"));
  await a.reader.cancel();
  await flush();
  expect((await b.reader.read()).done).toBe(true);
  expect(manager.counts).toEqual({ channels: 0, viewers: 0 });
  expect(sub.disconnect).toHaveBeenCalledWith(true);
});

it("clears the heartbeat and request abort listener on shutdown", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const stream = open("a", controller);
  await flush();
  await stream.reader.read();
  await stream.reader.read();
  await vi.advanceTimersByTimeAsync(25000);
  expect(decode((await stream.reader.read()).value)).toBe(": ping\n\n");
  shutdown.beginServerShutdown();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
