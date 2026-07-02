import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    deployment: { findFirst: vi.fn() },
    payrollRun: { findFirst: vi.fn(), findMany: vi.fn() },
    offRampPayoutJob: { findMany: vi.fn() },
  };
  return { mockDb };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireDevAuth: vi.fn(async () => ({ user: null })) }));

import { GET as deploymentFeed } from "@/app/api/deployments/[id]/payroll-events/route";
import { GET as runFeed } from "@/app/api/deployments/[id]/payroll-runs/[runId]/events/route";

function makeRequest(url: string) {
  return {
    url,
    headers: { get: (n: string) => (n === "x-dev-api-secret" ? "dev-secret" : null) },
  } as unknown as import("next/server").NextRequest;
}

const DEPLOY_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.deployment.findFirst.mockResolvedValue({ id: DEPLOY_ID });
  mockDb.payrollRun.findMany.mockResolvedValue([
    {
      id: RUN_ID,
      status: "CHARGED",
      totalStroops: "1000",
      txHash: "run-tx",
      chargedAt: new Date("2026-01-01T10:00:00Z"),
      createdAt: new Date("2026-01-01T09:00:00Z"),
      updatedAt: new Date("2026-01-01T10:00:00Z"),
      lastError: null,
      payouts: [
        {
          id: "payout-1",
          employeeId: "emp-1",
          amountStroops: "500",
          txHash: "payout-tx",
          createdAt: new Date("2026-01-01T09:30:00Z"),
          employee: { label: "Alice", address: "GABC" },
        },
      ],
    },
  ]);
  mockDb.offRampPayoutJob.findMany.mockResolvedValue([]);
});

describe("GET /api/deployments/:id/payroll-events", () => {
  it("returns a synthesized, newest-first feed", async () => {
    const res = await deploymentFeed(
      makeRequest(`http://x/api/deployments/${DEPLOY_ID}/payroll-events`),
      {
        params: Promise.resolve({ id: DEPLOY_ID }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextCursor).toBeNull();
    const kinds = body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("PAYROLL_RUN_CHARGED");
    expect(kinds).toContain("PAYOUT_COMPLETED");
    // newest-first
    const times = body.data.map((e: { occurredAt: string }) => e.occurredAt);
    expect([...times]).toEqual([...times].sort().reverse());
  });

  it("404s for an unknown deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await deploymentFeed(
      makeRequest(`http://x/api/deployments/${DEPLOY_ID}/payroll-events`),
      {
        params: Promise.resolve({ id: DEPLOY_ID }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("respects the limit and returns a cursor", async () => {
    const res = await deploymentFeed(
      makeRequest(`http://x/api/deployments/${DEPLOY_ID}/payroll-events?limit=1`),
      { params: Promise.resolve({ id: DEPLOY_ID }) },
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});

describe("GET /api/deployments/:id/payroll-runs/:runId/events", () => {
  it("404s when the run does not belong to the deployment", async () => {
    mockDb.payrollRun.findFirst.mockResolvedValue(null);
    const res = await runFeed(
      makeRequest(`http://x/api/deployments/${DEPLOY_ID}/payroll-runs/${RUN_ID}/events`),
      { params: Promise.resolve({ id: DEPLOY_ID, runId: RUN_ID }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns the run's events when it exists", async () => {
    mockDb.payrollRun.findFirst.mockResolvedValue({ id: RUN_ID });
    const res = await runFeed(
      makeRequest(`http://x/api/deployments/${DEPLOY_ID}/payroll-runs/${RUN_ID}/events`),
      { params: Promise.resolve({ id: DEPLOY_ID, runId: RUN_ID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(
      body.data.every(
        (e: { payrollRunId: string | null }) =>
          e.payrollRunId === RUN_ID || e.payrollRunId === null,
      ),
    ).toBe(true);
  });
});
