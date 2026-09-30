/**
 * #560 on the two relayer charge crons: a run that cannot take the lease touches nothing, and a
 * run out of time attempts no deployment. The charge paths themselves are covered in
 * auto-charge-payroll.test.ts and auto-charge-subscriptions.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, lease, limits } = vi.hoisted(() => ({
  mockDb: { deployment: { findMany: vi.fn(), update: vi.fn() } },
  lease: { held: false },
  limits: {
    autoChargePayroll: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
    autoChargeSubscriptions: { budgetMs: 240_000, ttlMs: 600_000, batch: 100 },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => ({
    CRON_SECRET: undefined,
    SUBSCRIPTION_MAX_CATCHUP_PER_RUN: 5,
    CONTRACT_READ_CACHE_ENABLED: false,
    CONTRACT_READ_CACHE_TTL_SECONDS: 300,
  }),
  stellarRelayerAddress: () => "GDRELAYER",
  stellarPassphrase: () => "Test SDF Network ; September 2015",
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
// Real modules: a charge attempt would hit an unmocked RPC and surface as a failed detail.
vi.mock("@/lib/stellar/relayer", async (orig) => orig());
vi.mock("@/lib/stellar/invoke", async (orig) => orig());
vi.mock("@/lib/stellar/client", () => ({
  withRelayerLock: vi.fn((fn: () => unknown) => fn()),
  TENANT_RELAYER_TIMEOUT_MS: 25,
}));
vi.mock("@/lib/offramp/jobs", () => ({ createOffRampJobsForPayrollRun: vi.fn() }));
vi.mock("@/lib/cron/config", () => ({ CRON_LIMITS: limits }));
vi.mock("@/lib/cron/lease", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cron/lease")>("@/lib/cron/lease");
  return {
    ...actual,
    withCronLease: async <T>(_name: string, _ttl: number, fn: () => Promise<T>) =>
      lease.held ? { acquired: false as const } : { acquired: true as const, value: await fn() },
  };
});

import { NextRequest } from "next/server";
import { POST as payroll } from "@/app/api/cron/auto-charge-payroll/route";
import { POST as subscriptions } from "@/app/api/cron/auto-charge-subscriptions/route";

const crons = [
  { name: "auto-charge-payroll", post: payroll, cfg: limits.autoChargePayroll },
  { name: "auto-charge-subscriptions", post: subscriptions, cfg: limits.autoChargeSubscriptions },
];

describe.each(crons)("cron/$name", ({ name, post, cfg }) => {
  const call = () => post(new NextRequest(`http://localhost/api/cron/${name}`));

  beforeEach(() => {
    mockDb.deployment.findMany.mockReset();
    mockDb.deployment.update.mockReset();
    lease.held = false;
    cfg.budgetMs = 240_000;
  });

  it("reports leaseHeld and touches no deployment while the previous run holds the lease", async () => {
    lease.held = true;

    const res = await call();

    expect(res.status).toBe(200);
    const { data } = await res.json();
    // The success shape with everything zeroed; payroll alone reports `processed`.
    expect(data).toEqual({
      platformCharged: 0,
      userCharged: 0,
      skipped: 0,
      failed: 0,
      ...(name === "auto-charge-payroll" ? { processed: 0 } : {}),
      details: [],
      truncated: false,
      leaseHeld: true,
    });
    expect(mockDb.deployment.findMany).not.toHaveBeenCalled();
  });

  it("reads a bounded batch, most overdue first", async () => {
    mockDb.deployment.findMany.mockResolvedValue([]);

    const res = await call();

    expect(mockDb.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ nextChargeAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: 100,
      }),
    );
    expect((await res.json()).data.truncated).toBe(false);
  });

  it("with a 0 ms budget attempts nothing and reports truncated", async () => {
    cfg.budgetMs = 0;
    mockDb.deployment.findMany.mockResolvedValue([
      { id: "d1", pipelineSnapshot: [], chargeEndAt: null },
      { id: "d2", pipelineSnapshot: [], chargeEndAt: null },
    ]);

    const res = await call();

    const body = await res.json();
    expect(body.data.truncated).toBe(true);
    expect(body.data.details).toEqual([]);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });
});
