// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayrollRunStatus } from "@prisma/client";
const { mockDb, mockEnv, mockRelayer } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockDb)),
    deployment: {
      findFirst: vi.fn(),
    },
    payrollRun: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    payrollPayout: {
      create: vi.fn(),
    },
  };
  const mockEnv = {
    LOG_LEVEL: "silent",
  };
  const mockRelayer = {
    readSplitterRecipients: vi.fn(),
    readSubscriptionAmountPerPeriod: vi.fn(),
    readPayrollRecipients: vi.fn(),
  };
  return { mockDb, mockEnv, mockRelayer };
});
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => mockEnv }));
vi.mock("@/lib/auth", () => ({
  requirePayrollSession: vi.fn(async () => ({
    user: { id: "owner-1", username: "owner", role: "USER" },
  })),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/relayer", () => mockRelayer);
import { POST } from "@/app/api/deployments/[id]/payroll-record-run/route";
function makeRequest({
  deploymentId,
  txHash,
  secret = "dev-secret",
}: {
  deploymentId: string;
  txHash: string;
  secret?: string;
}) {
  return {
    headers: {
      get: (name: string) =>
        name === "x-dev-api-secret" ? secret : name === "content-type" ? "application/json" : null,
    },
    json: async () => ({ txHash }),
  } as unknown as import("next/server").NextRequest;
}
function makeContext(deploymentId: string) {
  return { params: Promise.resolve({ id: deploymentId }) };
}
function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    flow: { templateKind: "PAYROLL" },
    pipelineSnapshot: [
      { nodeId: "sub", contractAddress: "CSub", templateKind: "SUBSCRIPTION" },
      { nodeId: "split", contractAddress: "CSplit", templateKind: "SPLITTER" },
    ],
    ...overrides,
  };
}
describe("payroll-record-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("records a crypto payroll run with its payout records", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(
      makeDeployment({
        pipelineSnapshot: [
          { nodeId: "sub", contractAddress: "CSub", templateKind: "SUBSCRIPTION" },
          { nodeId: "split", contractAddress: "CSplit", templateKind: "SPLITTER" },
        ],
      }),
    );
    mockDb.payrollRun.findUnique.mockResolvedValue(null);
    mockRelayer.readSplitterRecipients.mockResolvedValue([
      { address: "GCRYPTO", bps: 0, amount: "5000000" },
    ]);
    mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(10000000n);
    mockDb.employee.findMany.mockResolvedValue([
      {
        id: "emp-crypto",
        address: "GCRYPTO",
      },
    ]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-2" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-crypto" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ payrollRunId: "run-2", payoutCount: 1 });
    expect(mockDb.payrollPayout.create).toHaveBeenCalledWith({
      data: {
        payrollRunId: "run-2",
        employeeId: "emp-1",
        amountStroops: "5000000",
        txHash: "tx-crypto",
      },
    });
  });
  it("computes percentage-mode amounts from the subscription amount", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue(null);
    mockRelayer.readSplitterRecipients.mockResolvedValue([
      { address: "GCRYPTO", bps: 5000, amount: "0" },
      { address: "GCRYPTO2", bps: 5000, amount: "0" },
    ]);
    mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(10000000n);
    mockDb.employee.findMany.mockResolvedValue([]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-2" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-pct" });
    await POST(req, makeContext("dep-1"));
    expect(mockDb.payrollPayout.create).toHaveBeenCalledTimes(2);
    expect(mockDb.payrollPayout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountStroops: "5000000" }),
      }),
    );
  });
  it("returns idempotent results when the txHash already exists", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue({
      id: "run-existing",
      deploymentId: "dep-1",
      payouts: [{ id: "payout-existing" }],
    });
    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-dup" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.idempotent).toBe(true);
    expect(json.data.payrollRunId).toBe("run-existing");
    expect(json.data.payoutCount).toBe(1);
    expect(mockDb.payrollRun.create).not.toHaveBeenCalled();
  });
  // txHash is unique globally, so the idempotency lookup is not scoped by the
  // owner check above it: a caller who observed another tenant's charge on-chain
  // could otherwise read back its run id and payout count.
  it("409s rather than returning a run recorded under another deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue({
      id: "run-somebody-else",
      deploymentId: "dep-2",
      payouts: [{ id: "payout-somebody-else" }],
    });
    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-theirs" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(JSON.stringify(json)).not.toContain("somebody-else");
    expect(mockRelayer.readSplitterRecipients).not.toHaveBeenCalled();
    expect(mockDb.payrollRun.create).not.toHaveBeenCalled();
  });
});
