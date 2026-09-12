/**
 * `shared` tells a caller whether the count it just got is instance-wide or a
 * per-process guess. Endpoints whose limit is a security control rather than a
 * courtesy — `POST /api/auth/sandbox`, which creates a row for a caller with no
 * account — refuse the request when it is false.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedis } = vi.hoisted(() => ({ mockRedis: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: mockRedis }));

import { rateLimit } from "@/lib/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
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
