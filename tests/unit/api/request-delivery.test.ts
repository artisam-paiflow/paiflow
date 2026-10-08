import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  redis: {
    status: "ready",
    eval: vi.fn(),
    zrange: vi.fn(),
    zrem: vi.fn(),
    hincrby: vi.fn(),
    zcard: vi.fn(),
    hgetall: vi.fn(),
  },
  db: {
    apiRequestLog: { createMany: vi.fn() },
    analyticsDelivery: { createMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/lib/redis", () => ({ redis: () => h.redis }));
vi.mock("@/lib/db", () => ({ db: h.db }));
import {
  queueApiRequest,
  drainApiRequests,
  apiRequestHealth,
} from "@/lib/api/request-history/delivery";
import { eventProperties } from "@/lib/analytics/event-policy";
const record = {
  id: randomUUID(),
  requestId: randomUUID(),
  occurredAt: new Date().toISOString(),
  accountId: null,
  tokenCreatorId: null,
  apiTokenId: null,
  deploymentId: null,
  txHash: null,
  preparationRequestId: null,
  callerType: "unknown" as const,
  method: "GET" as const,
  endpoint: "/api/v1/deployments/:id/events",
  status: 401,
  durationMs: 10,
  errorCode: "UNAUTHENTICATED" as const,
  network: "testnet" as const,
  environment: "staging",
  appVersion: "test",
  audience: "UNCLASSIFIED" as const,
  trackingVersion: "api-requests-v1" as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.redis.status = "ready";
  h.redis.eval.mockResolvedValue(1);
  h.redis.zrange.mockResolvedValue([]);
  h.redis.zrem.mockResolvedValue(1);
  h.redis.zcard.mockResolvedValue(0);
  h.redis.hgetall.mockResolvedValue({});
  h.db.$transaction.mockImplementation((fn) => fn(h.db));
  h.db.$executeRaw.mockResolvedValue(0);
  h.db.apiRequestLog.createMany.mockResolvedValue({ count: 1 });
  h.db.analyticsDelivery.createMany.mockResolvedValue({ count: 1 });
  h.db.analyticsDelivery.count.mockResolvedValue(0);
  h.db.analyticsDelivery.findFirst.mockResolvedValue(null);
});
describe("bounded API telemetry delivery", () => {
  it("rejects overflow and validates before enqueue", async () => {
    h.redis.eval.mockResolvedValue(0);
    expect(await queueApiRequest(record)).toBe(false);
    expect(await queueApiRequest({ ...record, endpoint: "secret" })).toBe(false);
    expect(h.redis.eval).toHaveBeenCalledOnce();
  });
  it("bounds the acknowledgement wait and handles connection failure", async () => {
    vi.useFakeTimers();
    h.redis.eval.mockReturnValue(new Promise(() => {}));
    const promise = queueApiRequest(record);
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(false);
    vi.useRealTimers();
    h.redis.eval.mockRejectedValue(new Error("offline"));
    expect(await queueApiRequest(record)).toBe(false);
  });
  it("commits request and outbox before removing queue members; replay uses stable IDs", async () => {
    h.redis.zrange.mockImplementation((_, a, b) =>
      b === 199 ? Promise.resolve([JSON.stringify(record)]) : Promise.resolve([]),
    );
    await drainApiRequests();
    await drainApiRequests();
    expect(h.db.apiRequestLog.createMany).toHaveBeenCalledWith({
      data: [{ ...record, occurredAt: new Date(record.occurredAt) }],
      skipDuplicates: true,
    });
    expect(h.db.analyticsDelivery.createMany.mock.calls[0]![0].data[0]).toMatchObject({
      id: record.id,
      event: "api_request_completed",
      personProfile: false,
    });
    expect(h.db.analyticsDelivery.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.redis.zrem.mock.invocationCallOrder[0]!,
    );
  });
  it("retains valid members when persistence fails, for later retry", async () => {
    h.redis.zrange.mockImplementation((_, a, b) =>
      b === 199 ? Promise.resolve([JSON.stringify(record)]) : Promise.resolve([]),
    );
    h.db.apiRequestLog.createMany.mockRejectedValue(new Error("db failed"));
    await drainApiRequests();
    expect(h.redis.zrem).not.toHaveBeenCalled();
    expect(h.redis.hincrby).toHaveBeenCalledWith(expect.any(String), "delivery_failures", 1);
  });
  it("drops poisoned records and exposes health", async () => {
    h.redis.zrange.mockImplementation((_, a, b) =>
      b === 199 ? Promise.resolve(['{"body":"secret"}']) : Promise.resolve([]),
    );
    await drainApiRequests();
    expect(h.db.apiRequestLog.createMany).not.toHaveBeenCalled();
    expect(h.redis.hincrby).toHaveBeenCalledWith(expect.any(String), "invalid", 1);
  });
  it("exports DB delivery health when Redis is still connecting", async () => {
    h.redis.status = "connecting";
    h.db.analyticsDelivery.count.mockResolvedValue(12);
    expect(await apiRequestHealth()).toMatchObject({
      queueAvailable: false,
      pending: null,
      analyticsPending: 12,
    });
    expect(h.redis.zcard).not.toHaveBeenCalled();
  });
  it("keeps queue failures separate from DB delivery totals", async () => {
    h.redis.zcard.mockRejectedValue(new Error("offline"));
    expect(await apiRequestHealth()).toMatchObject({
      queueAvailable: false,
      pending: null,
      analyticsPending: 0,
    });
  });
  it("restricts final PostHog properties", () => {
    const props = eventProperties("api_request_completed", {
      request_id: record.id,
      endpoint: record.endpoint,
      method: "GET",
      duration_ms: 10,
      http_status: 401,
      api_token_id: record.id,
      error_code: "UNAUTHENTICATED",
      body: "secret",
      authorization: "secret",
      token_creator_id: "secret",
    });
    expect(props).toEqual({
      request_id: record.id,
      endpoint: record.endpoint,
      method: "GET",
      duration_ms: 10,
      http_status: 401,
      api_token_id: record.id,
      error_code: "UNAUTHENTICATED",
    });
  });
});
