import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { reconcile, deliver, lease } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  deliver: vi.fn(),
  lease: vi.fn(),
}));
vi.mock("@/lib/stellar/reconcile-transactions", () => ({ reconcileTransactions: reconcile }));
vi.mock("@/lib/api/request-history/delivery", () => ({
  drainApiRequests: vi.fn(async () => ({ persisted: 0 })),
}));
vi.mock("@/lib/analytics/outbox", () => ({ deliverOutbox: deliver }));
vi.mock("@/lib/cron/lease", () => ({ withCronLease: lease }));

const secret = "local-cron-test-000000000000000000000000";
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRON_SECRET", secret);
  reconcile.mockResolvedValue({ checked: 1, confirmed: 1, failed: 0, unresolved: 0 });
  deliver.mockResolvedValue({ delivered: 1 });
  lease.mockImplementation(async (_name: string, _ttl: number, run: () => Promise<unknown>) => ({
    acquired: true,
    value: await run(),
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("transaction reconciliation cron boundary", () => {
  it("refuses missing or wrong credentials before any work", async () => {
    const { POST } = await import("@/app/api/cron/reconcile-transactions/route");
    for (const headers of [new Headers(), new Headers({ "x-cron-secret": "wrong" })]) {
      const response = await POST(
        new NextRequest("https://app.example/api/cron/reconcile-transactions", {
          method: "POST",
          headers,
        }),
      );
      expect(response.status).toBe(403);
    }
    expect(lease).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("fails closed when production has no configured cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { POST } = await import("@/app/api/cron/reconcile-transactions/route");
    expect(
      (await POST(new NextRequest("https://app.example/api/cron/reconcile-transactions"))).status,
    ).toBe(403);
    expect(lease).not.toHaveBeenCalled();
  });

  it("does no reconciliation or delivery while the lease is held", async () => {
    lease.mockResolvedValue({ acquired: false });
    const { GET } = await import("@/app/api/cron/reconcile-transactions/route");
    const response = await GET(
      new NextRequest("https://app.example/api/cron/reconcile-transactions", {
        headers: { "x-cron-secret": secret },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ checked: 0, leaseHeld: true });
    expect(reconcile).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers only after reconciliation, within the configured lease", async () => {
    const { POST } = await import("@/app/api/cron/reconcile-transactions/route");
    const response = await POST(
      new NextRequest("https://app.example/api/cron/reconcile-transactions", {
        method: "POST",
        headers: { "x-cron-secret": secret },
      }),
    );
    expect(response.status).toBe(200);
    expect(lease).toHaveBeenCalledWith("reconcile-transactions", 60_000, expect.any(Function));
    expect(deliver).toHaveBeenCalledWith({ batch: 20, budgetMs: 6_000 });
    expect(reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      deliver.mock.invocationCallOrder[0]!,
    );
  });
});
