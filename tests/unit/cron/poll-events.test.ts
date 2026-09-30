import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const { mockDb, mockPoll, limits, redisState } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockDb: { deployment: { findMany: vi.fn() } },
    mockPoll: vi.fn(),
    limits: { pollEvents: { budgetMs: 50_000, ttlMs: 150_000, batch: 200 } },
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
    mockPoll.mockReset();
    redisState.store.clear();
    redisState.enabled = true;
    limits.pollEvents.budgetMs = 50_000;
    limits.pollEvents.batch = 200;
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    expect(mockDb.deployment.findMany).toHaveBeenNthCalledWith(2, {
      where: { AND: [where, { cursor: { isNot: null } }] },
      select: { id: true },
      orderBy: [{ cursor: { updatedAt: "asc" } }, { id: "asc" }],
      take: 199,
    });
    expect(mockPoll.mock.calls).toEqual([["d1"], ["d2"]]);
    expect(await res.json()).toEqual({
      data: { polled: 2, written: 3, errors: 0, deployments: 2, truncated: false },
    });
  });

  it("skips the second read when never-polled deployments fill the batch", async () => {
    limits.pollEvents.batch = 2;
    primeSelection([{ id: "d1" }, { id: "d2" }], []);
    mockPoll.mockResolvedValue(0);

    await post();

    expect(mockDb.deployment.findMany).toHaveBeenCalledTimes(1);
    expect(mockPoll).toHaveBeenCalledTimes(2);
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

  it("returns skipped and touches no deployment while the previous run holds the lease", async () => {
    redisState.store.set("cron:poll-events", "previous-run");

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { skipped: "previous run still active" } });
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
