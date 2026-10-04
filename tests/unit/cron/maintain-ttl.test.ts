import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const { guard, run, lease } = vi.hoisted(() => ({ guard: vi.fn(), run: vi.fn(), lease: vi.fn() }));
vi.mock("@/lib/auth/cron-secret", () => ({ requireCronSecret: guard }));
vi.mock("@/lib/stellar/ttl-maintenance", () => ({
  runTtlMaintenance: run,
  TTL_LIMITS: { ttlMs: 600_000 },
}));
vi.mock("@/lib/cron/lease", () => ({ withCronLease: lease }));
import { POST } from "@/app/api/cron/maintain-ttl/route";
import { AppError } from "@/lib/errors";
beforeEach(() => {
  vi.clearAllMocks();
  lease.mockImplementation(async (_name, _ttl, fn) => ({ acquired: true, value: await fn() }));
  run.mockResolvedValue({ dryRun: true, submissions: 0 });
});
it("guards public cron before leasing or running", async () => {
  guard.mockImplementationOnce(() => {
    throw new AppError("FORBIDDEN", "Bad cron secret");
  });
  const response = await POST(new NextRequest("https://example.com/api/cron/maintain-ttl"));
  expect(response.status).toBe(403);
  expect(lease).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("returns inventory report under a lease", async () => {
  const response = await POST(new NextRequest("https://example.com/api/cron/maintain-ttl"));
  expect(await response.json()).toEqual({ data: { dryRun: true, submissions: 0 } });
  expect(lease).toHaveBeenCalledWith("maintain-ttl", 600_000, run);
});
it("held lease avoids all maintenance work", async () => {
  lease.mockResolvedValueOnce({ acquired: false });
  const response = await POST(new NextRequest("https://example.com/api/cron/maintain-ttl"));
  expect(await response.json()).toEqual({
    data: {
      dryRun: true,
      deployments: 0,
      submissions: 0,
      truncated: false,
      budgetExhausted: false,
      moreDeployments: false,
      partialPipelines: false,
      details: [],
      failedDeployments: [],
      scans: [],
      leaseHeld: true,
    },
  });
  expect(run).not.toHaveBeenCalled();
});
