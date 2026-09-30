/**
 * The on-demand ingest in front of `GET /api/v1/deployments/{id}/events` (#724). The database,
 * Redis and the RPC poll are mocked; the keyset read itself is covered against Postgres in
 * `events.test.ts`.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireDeploymentToken: vi.fn(),
  pollEventsFor: vi.fn(),
  cursorFindUnique: vi.fn(),
  eventFindMany: vi.fn(),
  redisClient: null as null | { set: ReturnType<typeof vi.fn> },
}));

vi.mock("@/lib/api/v1/auth", () => ({
  requireDeploymentToken: mocks.requireDeploymentToken,
  bearerDeploymentToken: () => null,
}));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: mocks.pollEventsFor }));
vi.mock("@/lib/redis", () => ({ redis: () => mocks.redisClient }));
vi.mock("@/lib/db", () => ({
  db: {
    eventCursor: { findUnique: mocks.cursorFindUnique },
    contractEvent: { findMany: mocks.eventFindMany },
  },
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  EVENTS_REFRESH_DEADLINE_MS,
  EVENTS_REFRESH_LEASE_MS,
  EVENTS_STALE_AFTER_MS,
  refreshEventsIfStale,
} from "@/lib/api/v1/events-freshness";
import { GET } from "@/app/api/v1/deployments/[id]/events/route";

const NOW = new Date("2026-09-29T00:00:00Z").getTime();

// The module keeps per-deployment state (in-flight runs, the in-process claim), so every test
// uses a fresh deployment id rather than resetting modules.
let id: string;

const cursorAgedMs = (ms: number) =>
  mocks.cursorFindUnique.mockResolvedValue({ updatedAt: new Date(Date.now() - ms) });

const ROW = {
  id: "row-1",
  eventId: "0000000100-0000000001",
  kind: "PAYOUT",
  ledger: 100,
  txHash: "a".repeat(64),
  occurredAt: new Date(NOW),
  payload: { topics: ["payout"] },
  decodedData: { amount: "1" },
};

function callRoute(query = "") {
  const req = {
    url: `https://paiflow.test/api/v1/deployments/${id}/events${query}`,
    headers: new Headers({ authorization: "Bearer pfk_x" }),
  } as unknown as NextRequest;
  return GET(req, { params: Promise.resolve({ id }) });
}

function authAs(deployment: { status: string; contractAddress: string | null }) {
  mocks.requireDeploymentToken.mockResolvedValue({
    token: { id: `token-${crypto.randomUUID()}` },
    deployment: { id, ...deployment },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  id = crypto.randomUUID();
  mocks.redisClient = null;
  mocks.pollEventsFor.mockResolvedValue(0);
  mocks.eventFindMany.mockResolvedValue([ROW]);
  authAs({ status: "CONFIRMED", contractAddress: "CCONTRACT" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshEventsIfStale", () => {
  it("polls once when the cursor is older than the threshold", async () => {
    cursorAgedMs(60_000);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
    expect(mocks.pollEventsFor).toHaveBeenCalledWith(id);
  });

  it("polls when the deployment has never been polled", async () => {
    mocks.cursorFindUnique.mockResolvedValue(null);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("does not poll when the cursor is fresh", async () => {
    cursorAgedMs(EVENTS_STALE_AFTER_MS - 1_000);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).not.toHaveBeenCalled();
  });

  it("shares one poll between concurrent callers", async () => {
    cursorAgedMs(60_000);
    let finish!: () => void;
    mocks.pollEventsFor.mockReturnValue(new Promise<number>((r) => (finish = () => r(1))));

    const calls = [refreshEventsIfStale(id), refreshEventsIfStale(id), refreshEventsIfStale(id)];
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await Promise.all(calls);

    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
    expect(mocks.cursorFindUnique).toHaveBeenCalledTimes(1);
  });

  it("holds off the next poll for the full window even when the poll moved nothing", async () => {
    // The mocked poll never stamps the cursor, as on an interval with no new ledger.
    cursorAgedMs(60_000);
    await refreshEventsIfStale(id);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EVENTS_STALE_AFTER_MS);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(2);
  });

  it("does not start a second poll while a slow one outlasts the window", async () => {
    cursorAgedMs(60_000);
    let finish!: () => void;
    mocks.pollEventsFor.mockReturnValueOnce(new Promise<number>((r) => (finish = () => r(0))));

    const first = refreshEventsIfStale(id);
    await vi.advanceTimersByTimeAsync(EVENTS_STALE_AFTER_MS * 2);
    await first;
    // The in-flight run is still going; a later caller joins it instead of polling again.
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    // The window restarts when the poll ends, not when it started.
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EVENTS_STALE_AFTER_MS);
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(2);
  });

  it("makes a caller that joins a running poll wait only for what is left of the deadline", async () => {
    cursorAgedMs(60_000);
    mocks.pollEventsFor.mockReturnValue(new Promise<number>(() => {}));

    void refreshEventsIfStale(id);
    await vi.advanceTimersByTimeAsync(EVENTS_REFRESH_DEADLINE_MS - 1_000);

    let joined = false;
    const joiner = refreshEventsIfStale(id).then(() => (joined = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(joined).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await joiner;
    expect(joined).toBe(true);

    // Past the deadline, a caller does not wait at all.
    let late = false;
    const lateCall = refreshEventsIfStale(id).then(() => (late = true));
    await vi.advanceTimersByTimeAsync(0);
    await lateCall;
    expect(late).toBe(true);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed poll and still holds off the next one", async () => {
    cursorAgedMs(60_000);
    mocks.pollEventsFor.mockRejectedValueOnce(new Error("rpc down"));
    await expect(refreshEventsIfStale(id)).resolves.toBeUndefined();
    await refreshEventsIfStale(id);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed cursor read without polling", async () => {
    mocks.cursorFindUnique.mockRejectedValue(new Error("db down"));
    await expect(refreshEventsIfStale(id)).resolves.toBeUndefined();
    expect(mocks.pollEventsFor).not.toHaveBeenCalled();
  });

  describe("with Redis", () => {
    it("leases the deployment across replicas for the poll, then cuts it to the window", async () => {
      const set = vi.fn(async () => "OK");
      mocks.redisClient = { set };
      cursorAgedMs(60_000);
      await refreshEventsIfStale(id);
      expect(set.mock.calls).toEqual([
        [`v1:events-refresh:${id}`, "1", "PX", EVENTS_REFRESH_LEASE_MS, "NX"],
        [`v1:events-refresh:${id}`, "1", "PX", EVENTS_STALE_AFTER_MS],
      ]);
      expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
    });

    it("cuts the lease back even when the poll fails", async () => {
      const set = vi.fn(async () => "OK");
      mocks.redisClient = { set };
      cursorAgedMs(60_000);
      mocks.pollEventsFor.mockRejectedValueOnce(new Error("rpc down"));
      await refreshEventsIfStale(id);
      expect(set).toHaveBeenLastCalledWith(
        `v1:events-refresh:${id}`,
        "1",
        "PX",
        EVENTS_STALE_AFTER_MS,
      );
    });

    it("does not poll when another replica holds the claim", async () => {
      mocks.redisClient = { set: vi.fn(async () => null) };
      cursorAgedMs(60_000);
      await refreshEventsIfStale(id);
      expect(mocks.pollEventsFor).not.toHaveBeenCalled();
    });

    it("falls back to the in-process claim when Redis errors", async () => {
      mocks.redisClient = { set: vi.fn().mockRejectedValue(new Error("redis down")) };
      cursorAgedMs(60_000);
      await refreshEventsIfStale(id);
      await refreshEventsIfStale(id);
      expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GET /api/v1/deployments/{id}/events", () => {
  it("returns the stored rows when the on-demand poll fails", async () => {
    cursorAgedMs(60_000);
    mocks.pollEventsFor.mockRejectedValue(new Error("rpc down"));

    const res = await callRoute();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.map((i: { eventId: string }) => i.eventId)).toEqual([ROW.eventId]);
    expect(mocks.pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("answers from the stored rows once the deadline passes on a hung poll", async () => {
    cursorAgedMs(60_000);
    mocks.pollEventsFor.mockReturnValue(new Promise<number>(() => {}));

    let settled = false;
    const pending = callRoute().then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(EVENTS_REFRESH_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(res.status).toBe(200);
    expect((await res.json()).data.items).toHaveLength(1);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
  });

  it("polls once for a stale cursor and reads after the poll", async () => {
    cursorAgedMs(60_000);
    const order: string[] = [];
    mocks.pollEventsFor.mockImplementation(async () => {
      order.push("poll");
      return 1;
    });
    mocks.eventFindMany.mockImplementation(async () => {
      order.push("read");
      return [ROW];
    });

    await callRoute();
    expect(order).toEqual(["poll", "read"]);
  });

  it("does not poll for a fresh cursor", async () => {
    cursorAgedMs(1_000);
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(mocks.pollEventsFor).not.toHaveBeenCalled();
  });

  it("skips the refresh for a deployment that is not live", async () => {
    authAs({ status: "PENDING", contractAddress: null });
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(mocks.cursorFindUnique).not.toHaveBeenCalled();
    expect(mocks.pollEventsFor).not.toHaveBeenCalled();
  });

  it("rejects a malformed query before touching RPC", async () => {
    cursorAgedMs(60_000);
    const res = await callRoute("?cursor=");
    expect(res.status).toBe(422);
    expect(mocks.cursorFindUnique).not.toHaveBeenCalled();
    expect(mocks.pollEventsFor).not.toHaveBeenCalled();
  });
});
