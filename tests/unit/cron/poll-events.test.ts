import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const { mockDb, mockPoll, limits, redisState } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockDb: { deployment: { findMany: vi.fn(), updateMany: vi.fn() } },
    mockPoll: vi.fn(),
    limits: { pollEvents: { budgetMs: 20_000, ttlMs: 60_000, batch: 200, concurrency: 6 } },
    redisState: {
      store,
      client: {
        set: vi.fn(async (key: string, value: string) => {
          if (store.has(key)) return null;
          store.set(key, value);
          return "OK";
        }),
        eval: vi.fn(async (_s: string, _n: number, key: string, id: string) => {
          if (store.get(key) !== id) return 0;
          store.delete(key);
          return 1;
        }),
      },
      enabled: true,
    },
  };
});
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => ({ CRON_SECRET: undefined, LOG_LEVEL: "silent" }) }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: mockPoll }));
vi.mock("@/lib/cron/config", () => ({ CRON_LIMITS: limits }));
vi.mock("@/lib/redis", () => ({ redis: () => (redisState.enabled ? redisState.client : null) }));

import { POST } from "@/app/api/cron/poll-events/route";
import { SANDBOX_POLL_WINDOW_MS, cronPollableDeploymentWhere } from "@/lib/sandbox";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const attemptOrder = { eventsPolledAt: { sort: "asc", nulls: "first" } };

describe("cronPollableDeploymentWhere", () => {
  it("drops only deployments that are sandbox-owned and past the window", () => {
    expect(SANDBOX_POLL_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    // Both conditions sit in one object under NOT, which Prisma reads as
    // NOT (a AND b). Split across an array they would be NOT a AND NOT b, and
    // every real user's day-old deployment would stop being polled.
    expect(cronPollableDeploymentWhere(NOW)).toEqual({
      status: "CONFIRMED",
      NOT: {
        owner: { role: Role.SANDBOX },
        createdAt: { lt: new Date("2026-09-18T12:00:00.000Z") },
      },
    });
  });
});

/** The route reads never-polled deployments first, then the rest by cursor age. */
function primeSelection(unpolled: Array<{ id: string }>, polledBefore: Array<{ id: string }>) {
  mockDb.deployment.findMany.mockResolvedValueOnce(unpolled).mockResolvedValueOnce(polledBefore);
}

const post = () => POST(new NextRequest("http://localhost/api/cron/poll-events"));

describe("cron/poll-events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockDb.deployment.findMany.mockReset();
    mockDb.deployment.updateMany.mockReset().mockResolvedValue({ count: 1 });
    mockPoll.mockReset();
    redisState.store.clear();
    redisState.enabled = true;
    limits.pollEvents.budgetMs = 20_000;
    limits.pollEvents.batch = 200;
    limits.pollEvents.concurrency = 6;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects through the sandbox window, never-polled first, and polls each deployment", async () => {
    primeSelection([{ id: "d1" }], [{ id: "d2" }]);
    mockPoll.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const res = await post();

    const where = cronPollableDeploymentWhere(NOW);
    expect(mockDb.deployment.findMany).toHaveBeenNthCalledWith(1, {
      where: { AND: [where, { cursor: null }] },
      select: { id: true },
      orderBy: [attemptOrder, { createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    expect(mockDb.deployment.findMany).toHaveBeenNthCalledWith(2, {
      where: { AND: [where, { cursor: { isNot: null } }] },
      select: { id: true },
      orderBy: [attemptOrder, { cursor: { updatedAt: "asc" } }, { id: "asc" }],
      take: 199,
    });
    expect(mockPoll.mock.calls).toEqual([["d1"], ["d2"]]);
    expect(await res.json()).toEqual({
      data: { polled: 2, written: 3, errors: 0, deployments: 2, truncated: false },
    });
  });

  it("caps never-polled deployments at half the batch so polled ones always get slots", async () => {
    limits.pollEvents.batch = 4;
    primeSelection([{ id: "u1" }, { id: "u2" }], [{ id: "p1" }, { id: "p2" }]);
    mockPoll.mockResolvedValue(0);

    await post();

    expect(mockDb.deployment.findMany.mock.calls.map(([q]) => q.take)).toEqual([2, 2]);
    expect(mockPoll.mock.calls.map(([id]) => id)).toEqual(["u1", "u2", "p1", "p2"]);
  });

  it("keeps going when one deployment fails to poll", async () => {
    primeSelection([{ id: "d1" }, { id: "d2" }], []);
    mockPoll.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce(1);

    const res = await post();

    expect(mockPoll).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      data: { polled: 1, written: 1, errors: 1, deployments: 2, truncated: false },
    });
  });

  it("with a 0 ms budget polls nothing and reports truncated", async () => {
    limits.pollEvents.budgetMs = 0;
    primeSelection([{ id: "d1" }, { id: "d2" }], []);

    const res = await post();

    expect(mockPoll).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      data: { polled: 0, written: 0, errors: 0, deployments: 2, truncated: true },
    });
  });

  it("stops between deployments once the budget runs out", async () => {
    limits.pollEvents.budgetMs = 1_000;
    primeSelection([{ id: "d1" }, { id: "d2" }, { id: "d3" }], []);
    mockPoll.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 1_500));
      return 1;
    });

    const res = await post();

    expect(mockPoll.mock.calls).toEqual([["d1"]]);
    expect(await res.json()).toEqual({
      data: { polled: 1, written: 1, errors: 0, deployments: 3, truncated: true },
    });
  });

  it("polls at most `concurrency` deployments at once and still covers the batch", async () => {
    limits.pollEvents.concurrency = 3;
    primeSelection(
      Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` })),
      [],
    );
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    mockPoll.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return 1;
    });

    const pending = post();
    // Let every worker reach its first await, then finish polls one wave at a time.
    for (let i = 0; i < 10; i++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      expect(inFlight).toBeLessThanOrEqual(3);
      releases.shift()?.();
      await Promise.resolve();
    }
    const res = await pending;

    expect(peak).toBe(3);
    expect(mockPoll).toHaveBeenCalledTimes(10);
    expect(await res.json()).toEqual({
      data: { polled: 10, written: 10, errors: 0, deployments: 10, truncated: false },
    });
  });

  it("starts no new deployment once the budget is spent, but lets in-flight polls finish", async () => {
    limits.pollEvents.concurrency = 2;
    limits.pollEvents.budgetMs = 1_000;
    primeSelection([{ id: "d1" }, { id: "d2" }, { id: "d3" }, { id: "d4" }], []);
    // Both workers are mid-poll before the clock passes the budget.
    mockPoll.mockImplementation(async () => {
      await vi.waitFor(() => expect(mockPoll).toHaveBeenCalledTimes(2));
      vi.setSystemTime(new Date(NOW.getTime() + 1_500));
      return 1;
    });

    const res = await post();

    expect(mockPoll.mock.calls).toEqual([["d1"], ["d2"]]);
    expect(await res.json()).toEqual({
      data: { polled: 2, written: 2, errors: 0, deployments: 4, truncated: true },
    });
    // The unstarted tail is left unstamped so it leads the next tick.
    expect(mockDb.deployment.updateMany.mock.calls.map(([q]) => q.where.id).sort()).toEqual([
      "d1",
      "d2",
    ]);
  });

  it("one failing deployment does not stop the others under concurrency", async () => {
    limits.pollEvents.concurrency = 2;
    primeSelection([{ id: "d1" }, { id: "d2" }, { id: "d3" }, { id: "d4" }], []);
    mockPoll.mockImplementation(async (id: string) => {
      if (id === "d1") throw new Error("rpc down");
      return 2;
    });

    const res = await post();

    expect(mockPoll).toHaveBeenCalledTimes(4);
    expect(await res.json()).toEqual({
      data: { polled: 3, written: 6, errors: 1, deployments: 4, truncated: false },
    });
  });

  it("stamps eventsPolledAt after every attempt, failures included", async () => {
    primeSelection([{ id: "ok" }, { id: "bad" }], []);
    mockPoll.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("always fails");
      return 0;
    });

    await post();

    const stamped = mockDb.deployment.updateMany.mock.calls.map(([q]) => q.where.id).sort();
    expect(stamped).toEqual(["bad", "ok"]);
    expect(mockDb.deployment.updateMany.mock.calls[0]?.[0].data.eventsPolledAt).toEqual(NOW);
  });

  it("a failed stamp neither fails the run nor blocks later deployments", async () => {
    limits.pollEvents.concurrency = 1;
    primeSelection([{ id: "d1" }, { id: "d2" }], []);
    mockPoll.mockResolvedValue(1);
    mockDb.deployment.updateMany.mockRejectedValueOnce(new Error("db blip"));

    const res = await post();

    expect(mockPoll).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      data: { polled: 2, written: 2, errors: 0, deployments: 2, truncated: false },
    });
  });

  it("reports leaseHeld and touches no deployment while the previous run holds the lease", async () => {
    redisState.store.set("cron:poll-events", "previous-run");

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { polled: 0, written: 0, errors: 0, deployments: 0, truncated: false, leaseHeld: true },
    });
    expect(mockDb.deployment.findMany).not.toHaveBeenCalled();
    expect(mockPoll).not.toHaveBeenCalled();
    expect(redisState.store.get("cron:poll-events")).toBe("previous-run");
  });

  it("releases the lease after a run and after a throw", async () => {
    primeSelection([], []);
    await post();
    expect(redisState.store.has("cron:poll-events")).toBe(false);

    mockDb.deployment.findMany.mockRejectedValueOnce(new Error("db down"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(redisState.store.has("cron:poll-events")).toBe(false);
  });

  it("runs normally when Redis is unavailable", async () => {
    redisState.enabled = false;
    primeSelection([{ id: "d1" }], []);
    mockPoll.mockResolvedValueOnce(1);

    const res = await post();

    expect(mockPoll).toHaveBeenCalledWith("d1");
    expect(await res.json()).toEqual({
      data: { polled: 1, written: 1, errors: 0, deployments: 1, truncated: false },
    });
  });
});
