/**
 * `shared` tells a caller whether the count it just got is instance-wide or a
 * per-process guess. Endpoints whose limit is a security control rather than a
 * courtesy — `POST /api/auth/sandbox`, which creates a row for a caller with no
 * account — refuse the request when it is false.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedis, mockLog } = vi.hoisted(() => ({
  mockRedis: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/redis", () => ({ redis: mockRedis }));
vi.mock("@/lib/log", () => ({ log: mockLog }));

import { peekRateLimit, rateLimit, resetLimiterFallbackWarning } from "@/lib/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rateLimit reports the count and says when it falls back (#524)", () => {
  it("reports the running count past the limit", async () => {
    mockRedis.mockReturnValue(null);
    const key = `count-${Math.random()}`;
    await rateLimit(key, 1, 60);
    const second = await rateLimit(key, 1, 60);
    expect(second.count).toBe(2);
    expect(second.ok).toBe(false);
  });

  it("peekRateLimit reads without counting, and is 0 for an empty bucket", async () => {
    mockRedis.mockReturnValue(null);
    const key = `peek-${Math.random()}`;
    expect(await peekRateLimit(key)).toEqual({ count: 0, shared: false });
    await rateLimit(key, 5, 60);
    await rateLimit(key, 5, 60);
    expect((await peekRateLimit(key)).count).toBe(2);
    expect((await peekRateLimit(key)).count).toBe(2);
  });

  it("peekRateLimit reads the Redis counter when Redis answers", async () => {
    const get = vi.fn(async () => "7");
    mockRedis.mockReturnValue({ get });
    expect(await peekRateLimit("k")).toEqual({ count: 7, shared: true });
    expect(get).toHaveBeenCalledWith("rl:k");
  });

  it("logs a Redis error fallback, at most once a minute", async () => {
    resetLimiterFallbackWarning();
    mockRedis.mockReturnValue({
      incr: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    for (let i = 0; i < 5; i++) await rateLimit(`err-${Math.random()}`, 5, 60);
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn.mock.calls[0]![0]).toMatchObject({ reason: "error" });
  });

  it("repairs a counter left without an expiry, so its bucket cannot refuse forever", async () => {
    const expire = vi.fn(async () => 1);
    mockRedis.mockReturnValue({ incr: vi.fn(async () => 9), expire, ttl: vi.fn(async () => -1) });
    const r = await rateLimit("orphan", 5, 60);
    expect(r.ok).toBe(false);
    expect(expire).toHaveBeenCalledWith("rl:orphan", 60);
  });

  it("stays quiet about an unset REDIS_URL outside production", async () => {
    resetLimiterFallbackWarning();
    mockRedis.mockReturnValue(null);
    await rateLimit(`quiet-${Math.random()}`, 5, 60);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });
});

describe("rateLimit reports whether the bucket is shared", () => {
  it("is not shared when Redis is not configured", async () => {
    mockRedis.mockReturnValue(null);
    const r = await rateLimit(`no-redis-${Math.random()}`, 5, 60);
    expect(r.ok).toBe(true);
    expect(r.shared).toBe(false);
  });

  it("is not shared when the Redis call throws", async () => {
    mockRedis.mockReturnValue({
      incr: vi.fn(async () => {
        throw new Error("connection refused");
      }),
      expire: vi.fn(),
      ttl: vi.fn(),
    });
    const r = await rateLimit(`redis-down-${Math.random()}`, 5, 60);
    expect(r.ok).toBe(true);
    expect(r.shared).toBe(false);
  });

  it("is shared when Redis answers", async () => {
    mockRedis.mockReturnValue({
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 60),
    });
    const r = await rateLimit("redis-up", 5, 60);
    expect(r.shared).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("still reports over-limit from the in-memory fallback", async () => {
    mockRedis.mockReturnValue(null);
    const key = `burst-${Math.random()}`;
    await rateLimit(key, 2, 60);
    await rateLimit(key, 2, 60);
    const third = await rateLimit(key, 2, 60);
    expect(third.ok).toBe(false);
    expect(third.shared).toBe(false);
  });
});
