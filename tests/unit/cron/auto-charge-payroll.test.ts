import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChargeRelayerMode, PayrollRunStatus } from "@prisma/client";

const { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockJobs } = vi.hoisted(() => {
  const mockDb = {
    deployment: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    payrollRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      upsert: vi.fn(),
    },
    payrollPayout: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(mockDb)),
  };

  const mockEnv = {
    CRON_SECRET: "cron-secret",
    STELLAR_NETWORK: "testnet",
    STELLAR_RELAYER_ADDRESS: "GDRELAYER" as string | undefined,
  };

  const mockRelayer = {
    preparePayrollChargeByRelayerTx: vi.fn(),
    submitPayrollChargeByRelayerTx: vi.fn(),
    readPayrollIsCancelled: vi.fn(),
    readPayrollNextChargeAt: vi.fn(),
    readPayrollEmployer: vi.fn(),
    readPayrollAsset: vi.fn(),
    readPayrollRecipients: vi.fn(),
    readPayrollRelayer: vi.fn(),
    readTokenAllowance: vi.fn(),
    prepareSubscriptionChargeByRelayerTx: vi.fn(),
    submitSubscriptionChargeByRelayerTx: vi.fn(),
    readSubscriptionIsCancelled: vi.fn(),
    readSubscriptionNextChargeAt: vi.fn(),
    readSubscriptionAmountPerPeriod: vi.fn(),
    readSubscriptionSubscriberNullable: vi.fn(),
    readSubscriptionAsset: vi.fn(),
    readSubscriptionRelayer: vi.fn(),
    readSplitterDevRecipients: vi.fn(),
  };

  const mockInvoke = {
    preparePayrollChargeByRelayerUnsigned: vi.fn(),
  };

  const mockClient = {
    withRelayerLock: vi.fn((fn: any) => fn()),
  };

  const mockJobs = {
    createOffRampJobsForPayrollRun: vi.fn(),
  };

  return { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockJobs };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  stellarRelayerAddress: () => mockEnv.STELLAR_RELAYER_ADDRESS,
  stellarPassphrase: () => "Test SDF Network ; September 2015",
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/stellar/relayer", () => mockRelayer);
vi.mock("@/lib/stellar/invoke", () => mockInvoke);
vi.mock("@/lib/stellar/client", () => mockClient);
vi.mock("@/lib/offramp/jobs", () => mockJobs);

import { POST } from "@/app/api/cron/auto-charge-payroll/route";

function makeRequest(secret?: string) {
  return {
    headers: {
      get: (name: string) => (name === "x-cron-secret" ? (secret ?? null) : null),
    },
  } as unknown as import("next/server").NextRequest;
}

const now = new Date();
const nextChargeAt = Math.floor(now.getTime() / 1000) - 60;

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status: "CONFIRMED",
    flow: { templateKind: "PAYROLL" },
    pipelineSnapshot: [{ nodeId: "payroll", contractAddress: "C123", templateKind: "PAYROLL" }],
    chargeRelayerMode: ChargeRelayerMode.PLATFORM,
    chargeRelayerUrl: null,
    chargeRelayerToken: null,
    chargeRelayerAddress: null,
    nextChargeAt: now,
    chargeEndAt: null,
    lastChargedAt: null,
    offRampEnabled: false,
    ...overrides,
  };
}

describe("auto-charge-payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.STELLAR_RELAYER_ADDRESS = "GDRELAYER";
  });

  it("rejects requests without the cron secret", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(403);
  });

  it("skips when relayer address is not configured", async () => {
    mockEnv.STELLAR_RELAYER_ADDRESS = undefined;

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.notice).toContain("STELLAR_RELAYER_ADDRESS is not configured");
  });

  it("charges a platform payroll and creates run + payouts", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment()]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([
      { address: "GEMP1", amount: "5000000" },
      { address: "GEMP2", amount: "5000000" },
    ]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-1",
    });
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.platformCharged).toBe(1);
    expect(mockDb.payrollRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PayrollRunStatus.PENDING }),
      }),
    );
    expect(mockDb.employee.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.payrollPayout.create).toHaveBeenCalledTimes(2);
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: PayrollRunStatus.CHARGED, txHash: "tx-1" }),
      }),
    );
  });

  it("marks the run as FAILED when the charge fails", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment()]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "FAILED",
      errorMessage: "Simulation failed",
    });
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.failed).toBe(1);
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: PayrollRunStatus.FAILED }),
      }),
    );
  });

  it("creates off-ramp jobs when offRampEnabled is true", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment({ offRampEnabled: true })]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-1",
    });
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockResolvedValue(["job-1"]);

    const res = await POST(makeRequest("cron-secret"));
    await res.json();

    expect(mockJobs.createOffRampJobsForPayrollRun).toHaveBeenCalledWith(mockDb, "run-1");
  });

  it("skips when no chargeable contract is in the pipeline", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment({ pipelineSnapshot: [] })]);

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.skipped).toBe(1);
  });
});
