import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockDb, mockCapture } = vi.hoisted(() => ({
  mockDb: { deployment: { findMany: vi.fn(), updateMany: vi.fn() } },
  mockCapture: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => ({ CRON_SECRET: undefined, LOG_LEVEL: "silent" }) }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: mockCapture }));

import { POST } from "@/app/api/cron/finalize-deployments/route";

describe("cron/finalize-deployments", () => {
  beforeEach(() => {
    mockDb.deployment.findMany.mockReset();
    mockDb.deployment.updateMany.mockReset();
    mockCapture.mockClear();
  });

  it("reports only the deployments it actually failed", async () => {
    mockDb.deployment.findMany.mockResolvedValue([
      { id: "d-timed-out", ownerId: "u1", flowId: "f1" },
      { id: "d-confirmed-meanwhile", ownerId: "u2", flowId: "f2" },
    ]);
    // The second row was confirmed between the read and its conditional update.
    mockDb.deployment.updateMany.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        count: where.id === "d-timed-out" ? 1 : 0,
      }),
    );

    const res = await POST(new NextRequest("http://localhost/api/cron/finalize-deployments"));

    expect(await res.json()).toEqual({ data: { failed: 1 } });
    expect(mockDb.deployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-confirmed-meanwhile", status: "SUBMITTED" } }),
    );
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      "u1",
      "deploy_failed",
      expect.objectContaining({ deployment_id: "d-timed-out", stage: "finality_timeout" }),
    );
  });
});
