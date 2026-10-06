import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  select: vi.fn(),
  deployment: vi.fn(),
  stamp: vi.fn(),
  cursor: vi.fn(),
  getEvents: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findMany: mock.select, findUnique: mock.deployment, updateMany: mock.stamp },
    eventCursor: { updateMany: mock.cursor, createMany: vi.fn() },
  },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getEvents: mock.getEvents }) }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/flow-notifications", () => ({
  sendEmailNotificationsForTransactions: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/cron/poll-events/route";
import { CRON_LIMITS } from "@/lib/cron/config";

const NOW = new Date("2026-10-06T00:00:00Z");

/** Actual cron and reader with synthetic latency/persistence; no transport or chain calls. */
describe("pipeline event batching under the cron budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const deployments = Array.from({ length: 100 }, (_, i) => ({ id: `dep-${i}` }));
    mock.select.mockResolvedValueOnce([]).mockResolvedValueOnce(deployments);
    mock.deployment.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      contractAddress: `${where.id}-0`,
      status: "CONFIRMED",
      cursor: { lastLedger: 100 },
      graphSnapshot: null,
      flow: { templateKind: "DEPOSIT_TRIGGER" },
      pipelineSnapshot: Array.from({ length: 10 }, (_, i) => ({
        nodeId: `node-${i}`,
        contractAddress: `${where.id}-${i}`,
        templateKind: i === 0 ? "DEPOSIT_TRIGGER" : "PAYER",
      })),
    }));
    mock.stamp.mockResolvedValue({ count: 1 });
    mock.cursor.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    { latencyMs: 350, completed: 100, durationMs: 11_900, truncated: false },
    { latencyMs: 3000, completed: 24, durationMs: 24_000, truncated: true },
  ])(
    "bounds requests at $latencyMs ms without claiming unfinished coverage",
    async ({ latencyMs, completed, durationMs, truncated }) => {
      let active = 0;
      let peak = 0;
      const requestsByPipeline = new Map<string, number>();
      mock.getEvents.mockImplementation(
        async ({ filters }: { filters: { contractIds: string[] }[] }) => {
          const ids = filters[0]!.contractIds;
          expect(ids).toHaveLength(5);
          const deploymentId = ids[0]!.split("-").slice(0, 2).join("-");
          expect(ids.every((id) => id.startsWith(`${deploymentId}-`))).toBe(true);
          const pipelineActive = requestsByPipeline.get(deploymentId) ?? 0;
          expect(pipelineActive).toBe(0);
          requestsByPipeline.set(deploymentId, pipelineActive + 1);
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, latencyMs));
          active--;
          requestsByPipeline.set(deploymentId, 0);
          return { events: [], latestLedger: 200 };
        },
      );
      const pending = POST(new NextRequest("http://localhost/api/cron/poll-events"));
      await vi.runAllTimersAsync();
      const response = await pending;
      expect(await response.json()).toEqual({
        data: {
          deployments: 100,
          attempted: completed,
          polled: completed,
          partial: 0,
          failed: 0,
          skipped: 0,
          written: 0,
          errors: 0,
          truncated,
        },
      });
      expect(peak).toBe(CRON_LIMITS.pollEvents.concurrency);
      expect(active).toBe(0);
      expect(mock.getEvents).toHaveBeenCalledTimes(completed * 2);
      expect(mock.cursor).toHaveBeenCalledTimes(completed);
      expect(mock.stamp).toHaveBeenCalledTimes(completed);
      expect(Date.now() - NOW.getTime()).toBe(durationMs);
      expect(new Set(mock.cursor.mock.calls.map(([arg]) => arg.where.deploymentId)).size).toBe(
        completed,
      );
      for (const [arg] of mock.cursor.mock.calls) expect(arg.data.lastLedger).toBe(200);
    },
  );
});
