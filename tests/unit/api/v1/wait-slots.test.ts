/**
 * #524: the per-token semaphore over `execute/submit?wait=true`, in Redis and in the per-process
 * fallback: the cap holds, a release frees a slot, and a slot whose holder died frees itself when
 * its lease runs out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedis, mockLog } = vi.hoisted(() => ({
  mockRedis: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/redis", () => ({ redis: mockRedis }));
vi.mock("@/lib/log", () => ({ log: mockLog }));

import { V1_WAIT_SLOTS } from "@/lib/api/v1/limits";
import { acquireWaitSlot } from "@/lib/api/v1/wait-slots";
import { resetLimiterFallbackWarning } from "@/lib/rate-limit";

const CAP = V1_WAIT_SLOTS.perToken;

/** Just the sorted-set commands the semaphore uses, over an in-memory map. */
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const zset = (key: string) => {
    let s = sets.get(key);
    if (!s) {
      s = new Map();
      sets.set(key, s);
    }
    return s;
  };
  const client = {
    sets,
    zrem: vi.fn(async (key: string, member: string) => (zset(key).delete(member) ? 1 : 0)),
    multi() {
      const ops: Array<() => unknown> = [];
      const chain = {
        zremrangebyscore(key: string, _min: string, max: number) {
          ops.push(() => {
            let n = 0;
            for (const [m, score] of zset(key)) {
              if (score <= max) {
                zset(key).delete(m);
                n++;
              }
            }
            return n;
          });
          return chain;
        },
        zadd(key: string, score: number, member: string) {
          ops.push(() => (zset(key).set(member, score), 1));
          return chain;
        },
        zcard(key: string) {
          ops.push(() => zset(key).size);
          return chain;
        },
        pexpire(_key: string, _ms: number) {
          ops.push(() => 1);
          return chain;
        },
        async exec() {
          return ops.map((op) => [null, op()] as [null, unknown]);
        },
      };
      return chain;
    },
  };
  return client;
}

let tokenSeq = 0;
const nextToken = () => `token-${++tokenSeq}`;

beforeEach(() => {
  vi.clearAllMocks();
  resetLimiterFallbackWarning();
});

afterEach(() => {
  vi.restoreAllMocks();
});

for (const mode of ["redis", "memory"] as const) {
  describe(`wait slots (${mode})`, () => {
    beforeEach(() => {
      mockRedis.mockReturnValue(mode === "redis" ? fakeRedis() : null);
    });

    it(`grants ${CAP} per token and refuses the next`, async () => {
      const tokenId = nextToken();
      const held = [];
      for (let i = 0; i < CAP; i++) held.push(await acquireWaitSlot(tokenId));
      expect(held.every((s) => s !== null)).toBe(true);
      expect(await acquireWaitSlot(tokenId)).toBeNull();
    });

    it("a refused acquire does not itself take a slot", async () => {
      const tokenId = nextToken();
      const held = [];
      for (let i = 0; i < CAP; i++) held.push(await acquireWaitSlot(tokenId));
      expect(await acquireWaitSlot(tokenId)).toBeNull();
      expect(await acquireWaitSlot(tokenId)).toBeNull();
      await held[0]!.release();
      expect(await acquireWaitSlot(tokenId)).not.toBeNull();
      expect(await acquireWaitSlot(tokenId)).toBeNull();
    });

    it("is per token", async () => {
      const a = nextToken();
      for (let i = 0; i < CAP; i++) await acquireWaitSlot(a);
      expect(await acquireWaitSlot(a)).toBeNull();
      expect(await acquireWaitSlot(nextToken())).not.toBeNull();
    });

    it("a slot whose holder never released it frees itself when its lease expires", async () => {
      const tokenId = nextToken();
      const start = Date.now();
      const now = vi.spyOn(Date, "now").mockReturnValue(start);
      for (let i = 0; i < CAP; i++) await acquireWaitSlot(tokenId);
      expect(await acquireWaitSlot(tokenId)).toBeNull();

      now.mockReturnValue(start + V1_WAIT_SLOTS.leaseMs - 1);
      expect(await acquireWaitSlot(tokenId)).toBeNull();

      now.mockReturnValue(start + V1_WAIT_SLOTS.leaseMs);
      expect(await acquireWaitSlot(tokenId)).not.toBeNull();
    });
  });
}

describe("wait slots when Redis errors", () => {
  it("falls back to this process's slots and logs that it did", async () => {
    mockRedis.mockReturnValue({
      multi: () => {
        throw new Error("connection refused");
      },
      zrem: vi.fn(),
    });
    const tokenId = nextToken();
    for (let i = 0; i < CAP; i++) expect(await acquireWaitSlot(tokenId)).not.toBeNull();
    expect(await acquireWaitSlot(tokenId)).toBeNull();
    // Throttled: one line for the four fallbacks.
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn.mock.calls[0]![1]).toMatch(/no shared Redis/);
  });

  it("a failed Redis release is swallowed; the lease frees the slot", async () => {
    const client = fakeRedis();
    mockRedis.mockReturnValue(client);
    const slot = await acquireWaitSlot(nextToken());
    client.zrem.mockRejectedValueOnce(new Error("connection reset"));
    await expect(slot!.release()).resolves.toBeUndefined();
  });
});
