import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayrollRunStatus } from "@prisma/client";

const { mockDb, mockEnv, mockRelayer, mockJobs } = vi.hoisted(() => {
  const mockDb = {
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
    DEV_API_SECRET: "dev-secret",
    LOG_LEVEL: "silent",
  };

  const mockRelayer = {
    readSplitterDevRecipients: vi.fn(),
    readSubscriptionAmountPerPeriod: vi.fn(),
    readPayrollRecipients: vi.fn(),
  };

  const mockJobs = {
    createOffRampJobsForPayrollRun: vi.fn(),
  };

  return { mockDb, mockEnv, mockRelayer, mockJobs };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => mockEnv }));
vi.mock("@/lib/auth", () => ({ requireDevAuth: vi.fn(async () => ({ user: null })) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/relayer", () => mockRelayer);
vi.mock("@/lib/offramp/jobs", () => mockJobs);

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
    offRampEnabled: true,
    flow: { templateKind: "PAYROLL" },
    pipelineSnapshot: [
      { nodeId: "sub", contractAddress: "CSub", templateKind: "SUBSCRIPTION_DEV" },
      { nodeId: "split", contractAddress: "CSplit", templateKind: "SPLITTER_DEV" },
    ],
    ...overrides,
  };
}

describe("payroll-record-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a dev-mode payroll run and routes fiat payouts to CASH_OUT jobs", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue(null);
    mockRelayer.readSplitterDevRecipients.mockResolvedValue([
      { address: "GCRYPTO", bps: 0, amount: "5000000" },
      { address: "CCashOutFiat", bps: 0, amount: "5000000" },
    ]);
    mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(10000000n);
    mockDb.employee.findMany.mockResolvedValue([
      {
        id: "emp-crypto",
        address: "GCRYPTO",
        payoutMode: "CRYPTO",
        cashOutContractAddress: null,
      },
      {
        id: "emp-fiat",
        address: "GCRYPTO_BACKING",
        payoutMode: "FIAT",
        cashOutContractAddress: "CCashOutFiat",
      },
    ]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-upserted" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockResolvedValue(["job-1", "job-2"]);

    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-abc" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.payrollRunId).toBe("run-1");
    expect(json.data.payoutCount).toBe(2);
    expect(json.data.offRampJobIds).toEqual(["job-1", "job-2"]);
    expect(mockRelayer.readSplitterDevRecipients).toHaveBeenCalledWith("CSplit");
    expect(mockDb.payrollRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PayrollRunStatus.CHARGED,
          totalStroops: "10000000",
          txHash: "tx-abc",
        }),
      }),
    );
    expect(mockJobs.createOffRampJobsForPayrollRun).toHaveBeenCalledWith(mockDb, "run-1");
  });

  it("computes percentage-mode amounts from the subscription amount", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue(null);
    mockRelayer.readSplitterDevRecipients.mockResolvedValue([
      { address: "GCRYPTO", bps: 5000, amount: "0" },
      { address: "CCashOutFiat", bps: 5000, amount: "0" },
    ]);
    mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(10000000n);
    mockDb.employee.findMany.mockResolvedValue([]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-2" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockResolvedValue([]);

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
      payouts: [{ offRampJobs: [{ id: "job-existing" }] }],
      offRampJobs: [{ id: "job-existing" }],
    });

    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-dup" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.idempotent).toBe(true);
    expect(json.data.payrollRunId).toBe("run-existing");
    expect(mockDb.payrollRun.create).not.toHaveBeenCalled();
  });

  it("returns offRampError when job creation fails without failing the run", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.payrollRun.findUnique.mockResolvedValue(null);
    mockRelayer.readSplitterDevRecipients.mockResolvedValue([
      { address: "GCRYPTO", bps: 0, amount: "5000000" },
    ]);
    mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(10000000n);
    mockDb.employee.findMany.mockResolvedValue([]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-3" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockRejectedValue(new Error("PDAX not configured"));

    const req = makeRequest({ deploymentId: "dep-1", txHash: "tx-err" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.payrollRunId).toBe("run-3");
    expect(json.data.offRampJobIds).toEqual([]);
    expect(json.data.offRampError).toBe("PDAX not configured");
  });
});
