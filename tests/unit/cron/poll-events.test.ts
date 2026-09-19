import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const { mockDb, mockPoll } = vi.hoisted(() => ({
  mockDb: { deployment: { findMany: vi.fn() } },
  mockPoll: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => ({ CRON_SECRET: undefined, LOG_LEVEL: "silent" }) }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: mockPoll }));

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

describe("cron/poll-events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockDb.deployment.findMany.mockReset();
    mockPoll.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects through the sandbox window and polls each deployment it gets back", async () => {
    mockDb.deployment.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    mockPoll.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const res = await POST(new NextRequest("http://localhost/api/cron/poll-events"));

    expect(mockDb.deployment.findMany).toHaveBeenCalledWith({
      where: cronPollableDeploymentWhere(NOW),
      select: { id: true },
    });
    expect(mockPoll.mock.calls).toEqual([["d1"], ["d2"]]);
    expect(await res.json()).toEqual({
      data: { polled: 2, written: 3, errors: 0, deployments: 2 },
    });
  });

  it("keeps going when one deployment fails to poll", async () => {
    mockDb.deployment.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    mockPoll.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce(1);

    const res = await POST(new NextRequest("http://localhost/api/cron/poll-events"));

    expect(mockPoll).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      data: { polled: 1, written: 1, errors: 1, deployments: 2 },
    });
  });
});
