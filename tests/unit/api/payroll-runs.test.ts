import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  derivePayoutStatus,
  countCompletedPayouts,
  type PayoutForSerialize,
} from "@/lib/payroll/run-serialize";

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    deployment: { findFirst: vi.fn() },
    payrollRun: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  return { mockDb };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireDevAuth: vi.fn(async () => ({ user: null })) }));

import { GET as listGET } from "@/app/api/deployments/[id]/payroll-runs/route";
import { GET as detailGET } from "@/app/api/deployments/[id]/payroll-runs/[runId]/route";

// Path params are UUID-validated by the routes, so tests must use real UUIDs.
const DEP_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(url: string, secret = "dev-secret") {
  return {
    url,
    headers: { get: (n: string) => (n === "x-dev-api-secret" ? secret : null) },
  } as unknown as import("next/server").NextRequest;
}

function payout(overrides: Partial<PayoutForSerialize> = {}): PayoutForSerialize {
  return {
    id: "p1",
    employeeId: "e1",
    amountStroops: "5000000",
    txHash: "tx-1",
    employee: { label: "Alice", address: "GALICE", payoutMode: "CRYPTO" },
    offRampJobs: [],
    ...overrides,
  };
}

describe("derivePayoutStatus", () => {
  it("is PENDING without a charge tx", () => {
    expect(derivePayoutStatus("CRYPTO", null, null)).toBe("PENDING");
    expect(derivePayoutStatus("FIAT", null, "COMPLETED")).toBe("PENDING");
  });

  it("is COMPLETED for a pure-crypto payout with a tx", () => {
    expect(derivePayoutStatus("CRYPTO", "tx", null)).toBe("COMPLETED");
  });

  it("is SENT (not COMPLETED) for a FIAT payout charged but with no off-ramp job yet", () => {
    // Job creation is best-effort and can be skipped/swallowed; the fiat leg
    // is what completes the payout, so it must never read COMPLETED here.
    expect(derivePayoutStatus("FIAT", "tx", null)).toBe("SENT");
  });

  it("mirrors the off-ramp job lifecycle", () => {
    expect(derivePayoutStatus("FIAT", "tx", "PENDING")).toBe("SENT");
    expect(derivePayoutStatus("FIAT", "tx", "RUNNING")).toBe("SENT");
    expect(derivePayoutStatus("FIAT", "tx", "QUOTED")).toBe("SENT");
    expect(derivePayoutStatus("FIAT", "tx", "INITIATED")).toBe("SENT");
    expect(derivePayoutStatus("FIAT", "tx", "COMPLETED")).toBe("COMPLETED");
    expect(derivePayoutStatus("FIAT", "tx", "FAILED")).toBe("FAILED");
    expect(derivePayoutStatus("FIAT", "tx", "CANCELLED")).toBe("FAILED");
  });
});

describe("countCompletedPayouts", () => {
  it("counts only completed payouts", () => {
    const payouts = [
      payout({ txHash: "tx" }), // crypto completed
      payout({ txHash: null }), // pending
      payout({
        txHash: "tx",
        offRampJobs: [{ status: "FAILED", lastError: "x", completedAt: null }],
      }),
      payout({
        // FIAT charged but no off-ramp job → SENT, not counted
        txHash: "tx",
        employee: { label: "Fi", address: "GFIAT", payoutMode: "FIAT" },
      }),
    ];
    expect(countCompletedPayouts(payouts)).toBe(1);
  });
});

describe("GET payroll-runs (list)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns runs with payout counts and a nextCursor when full", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: "dep-1" });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const makeRun = (id: string) => ({
      id,
      status: "CHARGED",
      totalStroops: "10000000",
      runAt: now,
      chargedAt: now,
      txHash: "tx-" + id,
      createdAt: now,
      updatedAt: now,
      payouts: [
        payout({ id: id + "-a", txHash: "tx" }),
        payout({
          id: id + "-b",
          txHash: "tx",
          offRampJobs: [{ status: "PENDING", lastError: null, completedAt: null }],
        }),
      ],
    });
    // limit defaults to 20; return 2 runs (< limit) → no nextCursor
    mockDb.payrollRun.findMany.mockResolvedValue([makeRun("r1"), makeRun("r2")]);

    const res = await listGET(makeRequest(`https://x/api/deployments/${DEP_ID}/payroll-runs`), {
      params: Promise.resolve({ id: DEP_ID }),
    });
    const json = await res.json();

    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: "r1",
      status: "CHARGED",
      payoutCount: 2,
      completedPayoutCount: 1,
      triggeredAt: now.toISOString(),
    });
    expect(json.nextCursor).toBeNull();
  });

  it("emits a nextCursor when more than `limit` rows are returned", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: "dep-1" });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: "r" + i,
      status: "PENDING",
      totalStroops: "1",
      runAt: now,
      chargedAt: null,
      txHash: null,
      createdAt: now,
      updatedAt: now,
      payouts: [],
    }));
    mockDb.payrollRun.findMany.mockResolvedValue(rows);

    const res = await listGET(
      makeRequest(`https://x/api/deployments/${DEP_ID}/payroll-runs?limit=2`),
      {
        params: Promise.resolve({ id: DEP_ID }),
      },
    );
    const json = await res.json();

    expect(json.data).toHaveLength(2);
    expect(json.nextCursor).toBe("r2");
  });

  it("404s when the deployment is not found", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await listGET(makeRequest(`https://x/api/deployments/${DEP_ID}/payroll-runs`), {
      params: Promise.resolve({ id: DEP_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("404s on a malformed (non-UUID) deployment id without touching the db", async () => {
    const res = await listGET(makeRequest("https://x/api/deployments/not-a-uuid/payroll-runs"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
  });
});

describe("GET payroll-runs/:runId (detail)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a run with serialized payouts", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: "dep-1" });
    const now = new Date("2026-01-01T00:00:00.000Z");
    mockDb.payrollRun.findFirst.mockResolvedValue({
      id: "run-1",
      status: "CHARGED",
      totalStroops: "10000000",
      runAt: now,
      chargedAt: now,
      txHash: "tx-run",
      lastError: null,
      createdAt: now,
      updatedAt: now,
      payouts: [
        payout({
          id: "p-crypto",
          txHash: "tx",
          employee: { label: null, address: "GBOB", payoutMode: "CRYPTO" },
        }),
        payout({
          id: "p-fiat",
          txHash: "tx",
          employee: { label: "Bob", address: "GBOB2", payoutMode: "FIAT" },
          offRampJobs: [{ status: "INITIATED", lastError: null, completedAt: null }],
        }),
      ],
    });

    const res = await detailGET(
      makeRequest(`https://x/api/deployments/${DEP_ID}/payroll-runs/${RUN_ID}`),
      {
        params: Promise.resolve({ id: DEP_ID, runId: RUN_ID }),
      },
    );
    const json = await res.json();

    expect(json.id).toBe("run-1");
    expect(json.errorMessage).toBeNull();
    expect(json.payouts[0]).toMatchObject({
      id: "p-crypto",
      employeeLabel: "GBOB", // falls back to address when label is null
      mode: "CRYPTO",
      status: "COMPLETED",
      offRampJobStatus: null,
    });
    expect(json.payouts[1]).toMatchObject({
      id: "p-fiat",
      employeeLabel: "Bob",
      mode: "FIAT",
      status: "SENT",
      offRampJobStatus: "INITIATED",
    });
  });

  it("404s when the run does not belong to the deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: DEP_ID });
    mockDb.payrollRun.findFirst.mockResolvedValue(null);

    const res = await detailGET(
      makeRequest(
        `https://x/api/deployments/${DEP_ID}/payroll-runs/33333333-3333-3333-3333-333333333333`,
      ),
      {
        params: Promise.resolve({ id: DEP_ID, runId: "33333333-3333-3333-3333-333333333333" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("404s on a malformed (non-UUID) runId without touching the db", async () => {
    const res = await detailGET(
      makeRequest(`https://x/api/deployments/${DEP_ID}/payroll-runs/not-a-uuid`),
      {
        params: Promise.resolve({ id: DEP_ID, runId: "not-a-uuid" }),
      },
    );
    expect(res.status).toBe(404);
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
  });
});
