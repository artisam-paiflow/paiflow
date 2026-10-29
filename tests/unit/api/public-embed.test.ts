// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const PUBLIC_ORIGIN = vi.hoisted(() => {
  const origin = "https://customer.paiflow.test";
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  return origin;
});
afterAll(() => vi.unstubAllEnvs());
const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  events: vi.fn(),
  refresh: vi.fn(),
  rate: vi.fn(),
  slot: vi.fn(),
  qr: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { deployment: { findUnique: mocks.deployment }, contractEvent: { findMany: mocks.events } },
}));
vi.mock("@/lib/api/v1/events-freshness", () => ({ refreshEventsIfStale: mocks.refresh }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "198.51.100.1",
  rateLimit: mocks.rate,
  retryAfterSeconds: () => 15,
}));
vi.mock("@/lib/deployments/public-stream-slots", () => ({
  acquirePublicStreamSlot: mocks.slot,
  PUBLIC_STREAM_LIFETIME_MS: 55000,
}));
vi.mock("@/lib/redis", () => ({ eventChannel: (id: string) => `events:${id}` }));
vi.mock("qrcode", () => ({ default: { toString: mocks.qr } }));
import { GET as activity } from "@/app/api/deployments/[id]/embed/activity/route";
import { GET as qr } from "@/app/api/deployments/[id]/embed/qr/route";
import { GET as stream } from "@/app/api/deployments/[id]/embed/events/route";
const ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "private-synthetic-marker";
const row = () => ({
  id: ID,
  status: "CONFIRMED",
  serviceState: "ACTIVE",
  contractAddress: "C" + "A".repeat(55),
  network: "testnet",
  webhookSecret: SECRET,
  flow: { templateKind: "SPLITTER" },
  pipelineSnapshot: [{ templateKind: "DEPOSIT_TRIGGER", secret: SECRET }],
  graphSnapshot: {
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" }, secret: SECRET } },
    ],
    edges: [],
  },
});
const event = () => ({
  eventId: "event-1",
  kind: "PAYOUT",
  ledger: 20,
  txHash: "a".repeat(64),
  occurredAt: new Date("2026-10-07T00:00:00Z"),
  payload: { secret: SECRET },
  decodedData: { amount: "17", email: SECRET },
});
const req = (path: string, signal?: AbortSignal) =>
  new NextRequest(`https://paiflow.test/api/deployments/${ID}/embed/${path}`, { signal });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
let sub: EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let release: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.deployment.mockResolvedValue(row());
  mocks.events.mockResolvedValue([event()]);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.rate.mockResolvedValue({ ok: true });
  mocks.qr.mockResolvedValue("<svg>qr</svg>");
  sub = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  });
  release = vi.fn().mockResolvedValue(undefined);
  mocks.slot.mockResolvedValue({ client: { duplicate: () => sub }, release });
});
afterEach(() => vi.useRealTimers());
describe("public embed reads", () => {
  it("serves a sanitized catch-up snapshot with no session or token", async () => {
    const res = await activity(req("activity"), ctx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"amountStroops":"17"');
    for (const privateField of [
      SECRET,
      "payload",
      "decodedData",
      "webhookSecret",
      "pipelineSnapshot",
    ])
      expect(text).not.toContain(privateField);
    expect(mocks.refresh).toHaveBeenCalledWith(ID);
    expect(mocks.events.mock.calls[0]?.[0]).toMatchObject({ take: 50, select: { eventId: true } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    null,
    { ...row(), status: "PENDING" },
    { ...row(), contractAddress: null },
    { ...row(), graphSnapshot: {} },
  ])("rejects unavailable deployments before refreshing", async (deployment) => {
    mocks.deployment.mockResolvedValue(deployment);
    expect((await activity(req("activity"), ctx())).status).toBe(404);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects malformed ids before database access", async () => {
    expect((await activity(req("activity"), ctx("bad"))).status).toBe(404);
    expect(mocks.deployment).not.toHaveBeenCalled();
  });
  it("limits reads address-wide before lookup", async () => {
    mocks.rate.mockResolvedValue({ ok: false });
    const res = await activity(req("activity"), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(mocks.deployment).not.toHaveBeenCalled();
    expect(mocks.rate.mock.calls[0]?.[0]).toBe("public-embed:reads:198.51.100.1");
  });
  it("encodes only the customer payment page on the configured public origin", async () => {
    const res = await qr(req("qr"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(mocks.qr.mock.calls[0]?.[0]).toBe(`${PUBLIC_ORIGIN}/trigger/${ID}`);
  });
  it.each(["invoke", "allowance", "trigger", "pay"])(
    "rejects generic QR mode %s",
    async (action) => {
      expect((await qr(req(`qr?action=${action}`), ctx())).status).toBe(422);
      expect(mocks.qr).not.toHaveBeenCalled();
    },
  );
  it.each(["SUBSCRIPTION", "PAYROLL", "SCHEDULER", "ORACLE"])(
    "omits payment QR for %s",
    async (kind) => {
      mocks.deployment.mockResolvedValue({
        ...row(),
        flow: { templateKind: kind },
        pipelineSnapshot: [{ templateKind: kind }],
      });
      expect((await qr(req("qr"), ctx())).status).toBe(404);
      expect(mocks.qr).not.toHaveBeenCalled();
    },
  );
});
describe("public SSE lifecycle", () => {
  it("subscribes before safe catch-up, then catches later Redis notifications", async () => {
    const abort = new AbortController();
    const res = await stream(req("events", abort.signal), ctx());
    const reader = res.body!.getReader();
    const connected = new TextDecoder().decode((await reader.read()).value);
    expect(connected).toContain("event: connected");
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain("event: snapshot");
    expect(initial).not.toContain(SECRET);
    expect(sub.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.events.mock.invocationCallOrder[0]!,
    );
    mocks.events.mockResolvedValue([{ ...event(), eventId: "event-2" }]);
    sub.emit("message", `events:${ID}`, JSON.stringify({ webhookSecret: SECRET }));
    const next = new TextDecoder().decode((await reader.read()).value);
    expect(next).toContain("event-2");
    expect(next).not.toContain(SECRET);
    abort.abort();
    expect(sub.listenerCount("message")).toBe(0);
    expect(sub.disconnect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it("releases the subscription and slot on reader cancellation", async () => {
    const res = await stream(req("events"), ctx());
    await res.body!.cancel();
    expect(release).toHaveBeenCalledOnce();
    expect(sub.disconnect).toHaveBeenCalledOnce();
  });
  it("closes and releases when Redis drops", async () => {
    const res = await stream(req("events"), ctx());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    sub.emit("close");
    expect((await reader.read()).done).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
  it("releases on connection failure", async () => {
    sub.connect.mockRejectedValue(new Error("connection failure"));
    const res = await stream(req("events"), ctx());
    expect((await res.body!.getReader().read()).done).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
  it("closes before the slot lease expires", async () => {
    vi.useFakeTimers();
    const res = await stream(req("events"), ctx());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    await vi.advanceTimersByTimeAsync(55000);
    expect(release).toHaveBeenCalledOnce();
    await reader.cancel();
  });
  it("rejects excess connection attempts before allocating resources", async () => {
    mocks.rate.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    expect((await stream(req("events"), ctx())).status).toBe(429);
    expect(mocks.slot).not.toHaveBeenCalled();
  });
  it("returns a retryable failure without a shared slot store", async () => {
    mocks.slot.mockResolvedValue(null);
    const res = await stream(req("events"), ctx());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
