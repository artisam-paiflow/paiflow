import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OffRampPayoutJobStatus, OffRampJobSource } from "@prisma/client";

const { mockDb, mockEnv, mockProvider, mockJobs, mockAssets, mockDevMutate, mockEnvHelpers } =
  vi.hoisted(() => {
    const mockDb = {
      offRampPayoutJob: {
        update: vi.fn(),
      },
    };

    const mockEnv = {
      CRON_SECRET: "cron-secret",
      OFFRAMP_PROVIDER: "pdax",
    };

    const mockProvider = {
      name: "pdax",
      quote: vi.fn(),
      executeTrade: vi.fn(),
      initiatePayout: vi.fn(),
    };

    const mockJobs = {
      getDueOffRampJobs: vi.fn(),
      rescheduleOffRampJob: vi.fn(),
      cancelPendingOffRampJobs: vi.fn(),
    };

    const mockAssets = {
      resolveCashOutAsset: vi.fn(),
      resolvePayrollAsset: vi.fn(),
    };

    const mockDevMutate = {
      refundFromTreasury: vi.fn(),
      getTreasuryBalance: vi.fn(),
      depositNativeToProvider: vi.fn(),
    };

    const mockEnvHelpers = {
      address: undefined as string | undefined,
      memo: undefined as string | undefined,
    };

    return { mockDb, mockEnv, mockProvider, mockJobs, mockAssets, mockDevMutate, mockEnvHelpers };
  });

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  offRampPdaxDepositConfig: () => mockEnvHelpers,
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/offramp/jobs", () => mockJobs);
vi.mock("@/lib/offramp/provider", () => ({
  getOffRampProvider: () => mockProvider,
  offRampAssetCode: () => "USDC",
  offRampFiatCurrency: () => "PHP",
}));
vi.mock("@/lib/offramp/assets", () => mockAssets);
vi.mock("@/lib/stellar/dev-mutate", () => mockDevMutate);
vi.mock("@/lib/stellar/assets", () => ({ assetContractId: () => "CASSET" }));

import { POST } from "@/app/api/cron/process-offramp-jobs/route";

function makeRequest(secret?: string) {
  return {
    headers: {
      get: (name: string) => (name === "x-cron-secret" ? (secret ?? null) : null),
    },
  } as unknown as import("next/server").NextRequest;
}

const baseJob = {
  id: "job-1",
  deploymentId: "dep-1",
  source: OffRampJobSource.PAYROLL,
  sourceAddress: "GSource",
  amountStroops: "10000000",
  bankAccountName: "Juan Cruz",
  bankAccountNumber: "123456",
  bankCode: "BASECPH",
  payrollRunId: "run-1",
  employeeId: "emp-1",
  payrollPayoutId: "payout-1",
  status: OffRampPayoutJobStatus.PENDING,
  providerRef: null,
  tradeRef: null,
  requestId: null,
  providerQuote: null,
  runAt: new Date(),
  attemptCount: 0,
  lastError: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deployment: {
    status: "CONFIRMED",
    graphSnapshot: {},
    pipelineSnapshot: [],
    offRampSenderProfile: {
      firstName: "Juan",
      middleName: "n.a.",
      lastName: "Cruz",
      countryOrigin: "PH",
      addressLineOne: "123 Main",
      addressLineTwo: null,
      city: "Manila",
      province: "NCR",
      country: "PH",
      zipCode: "1000",
      phoneNumber: "+639171234567",
      nationality: "Filipino",
      nationalIdentityNumber: "123456789",
      dob: "01-01-1990",
      placeOfBirth: "Manila",
      sourceOfFunds: "Salary",
      email: "juan@example.com",
    },
  },
};

describe("process-offramp-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnvHelpers.address = undefined;
    mockEnvHelpers.memo = undefined;
  });

  it("rejects requests without the cron secret", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(403);
  });

  it("processes a job through quote, trade, and payout", async () => {
    mockJobs.getDueOffRampJobs.mockResolvedValue([baseJob]);
    mockAssets.resolvePayrollAsset.mockReturnValue({ kind: "usdc" });
    mockProvider.quote.mockResolvedValue({
      id: "quote-1",
      amountIn: "10000000",
      amountOut: "580000",
      fiatAmount: "58.00",
      fiatCurrency: "PHP",
      expiresAt: new Date(),
    });
    mockProvider.executeTrade.mockResolvedValue({
      providerRef: "trade-1",
      status: "PENDING",
    });
    mockProvider.initiatePayout.mockResolvedValue({
      providerRef: "payout-1",
      status: "COMPLETED",
    });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.completed).toBe(1);
    expect(mockProvider.quote).toHaveBeenCalled();
    expect(mockProvider.executeTrade).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: "quote-1", jobId: "job-1" }),
    );
    expect(mockProvider.initiatePayout).toHaveBeenCalled();
    expect(mockJobs.rescheduleOffRampJob).toHaveBeenCalledTimes(4);
  });

  it("refunds treasury on pre-trade failure", async () => {
    mockJobs.getDueOffRampJobs.mockResolvedValue([baseJob]);
    mockAssets.resolvePayrollAsset.mockReturnValue({ kind: "usdc" });
    mockProvider.quote.mockRejectedValue(new Error("PDAX quote rejected"));
    mockDevMutate.refundFromTreasury.mockResolvedValue({ status: "SUCCESS", txHash: "tx-1" });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.failed).toBe(1);
    expect(mockDevMutate.refundFromTreasury).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "GSource", amountStroops: "10000000" }),
    );
  });

  it("retries on retryable errors", async () => {
    const job = { ...baseJob, attemptCount: 0 };
    mockJobs.getDueOffRampJobs.mockResolvedValue([job]);
    mockAssets.resolvePayrollAsset.mockReturnValue({ kind: "usdc" });
    mockProvider.quote.mockRejectedValue(new Error("fetch failed"));

    const res = await POST(makeRequest("cron-secret"));
    await res.json();

    expect(mockDb.offRampPayoutJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          status: OffRampPayoutJobStatus.PENDING,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it("verifies treasury sink before trading for CASH_OUT jobs", async () => {
    const job = {
      ...baseJob,
      source: OffRampJobSource.CASH_OUT,
      sourceAddress: "CCashOut",
    };
    mockJobs.getDueOffRampJobs.mockResolvedValue([job]);
    mockAssets.resolveCashOutAsset.mockReturnValue({ kind: "known", symbol: "USDC" });
    mockDevMutate.getTreasuryBalance.mockResolvedValue(BigInt(job.amountStroops));
    mockProvider.quote.mockResolvedValue({
      id: "quote-1",
      amountIn: job.amountStroops,
      amountOut: "580000",
      fiatAmount: "58.00",
      fiatCurrency: "PHP",
      expiresAt: new Date(),
    });
    mockProvider.executeTrade.mockResolvedValue({
      providerRef: "trade-1",
      status: "PENDING",
    });
    mockProvider.initiatePayout.mockResolvedValue({
      providerRef: "payout-1",
      status: "COMPLETED",
    });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.completed).toBe(1);
    expect(mockDevMutate.getTreasuryBalance).toHaveBeenCalledWith("CASSET");
    expect(mockProvider.quote).toHaveBeenCalled();
  });

  it("fails and refunds CASH_OUT jobs when treasury sink is missing", async () => {
    const job = {
      ...baseJob,
      source: OffRampJobSource.CASH_OUT,
      sourceAddress: "CCashOut",
    };
    mockJobs.getDueOffRampJobs.mockResolvedValue([job]);
    mockAssets.resolveCashOutAsset.mockReturnValue({ kind: "known", symbol: "USDC" });
    mockDevMutate.getTreasuryBalance.mockResolvedValue(0n);
    mockDevMutate.refundFromTreasury.mockResolvedValue({ status: "SUCCESS", txHash: "tx-1" });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.failed).toBe(1);
    expect(mockProvider.quote).not.toHaveBeenCalled();
    expect(mockDevMutate.refundFromTreasury).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "CCashOut", amountStroops: job.amountStroops }),
    );
  });

  it("deposits native XLM to PDAX before trading for CASH_OUT jobs", async () => {
    const job = {
      ...baseJob,
      source: OffRampJobSource.CASH_OUT,
      sourceAddress: "CCashOut",
    };
    mockJobs.getDueOffRampJobs.mockResolvedValue([job]);
    mockAssets.resolveCashOutAsset.mockReturnValue({ kind: "native" });
    mockDevMutate.getTreasuryBalance.mockResolvedValue(BigInt(job.amountStroops));
    mockEnvHelpers.address = "GCK2MUVH6TABTXT4247CIEC5EO24CQQ4MZNW7EGBTP3TPGALLQI7P34G";
    mockEnvHelpers.memo = "3777239912";
    mockDevMutate.depositNativeToProvider.mockResolvedValue({
      status: "SUCCESS",
      txHash: "dep-tx-1",
    });
    mockProvider.quote.mockResolvedValue({
      id: "quote-1",
      amountIn: job.amountStroops,
      amountOut: "580000",
      fiatAmount: "58.00",
      fiatCurrency: "PHP",
      expiresAt: new Date(),
    });
    mockProvider.executeTrade.mockResolvedValue({
      providerRef: "trade-1",
      status: "PENDING",
    });
    mockProvider.initiatePayout.mockResolvedValue({
      providerRef: "payout-1",
      status: "COMPLETED",
    });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.completed).toBe(1);
    expect(mockDevMutate.depositNativeToProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "GCK2MUVH6TABTXT4247CIEC5EO24CQQ4MZNW7EGBTP3TPGALLQI7P34G",
        memo: "3777239912",
        amountStroops: job.amountStroops,
      }),
    );
    expect(mockProvider.quote).toHaveBeenCalled();
    expect(mockProvider.executeTrade).toHaveBeenCalled();
  });

  it("cancels jobs for non-confirmed deployments", async () => {
    const job = { ...baseJob, deployment: { ...baseJob.deployment, status: "DRAFT" } };
    mockJobs.getDueOffRampJobs.mockResolvedValue([job]);

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.cancelled).toBe(1);
    expect(mockJobs.cancelPendingOffRampJobs).toHaveBeenCalledWith(mockDb, "dep-1");
  });
});
