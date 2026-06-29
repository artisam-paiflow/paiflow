import { describe, it, expect, vi, beforeEach } from "vitest";
import { OffRampJobSource, OffRampPayoutJobStatus } from "@prisma/client";
import { createOffRampJobsForPayrollRun } from "@/lib/offramp/jobs";

type MockPayout = {
  id: string;
  employeeId: string;
  amountStroops: string;
  employee: {
    id: string;
    payoutMode: "CRYPTO" | "FIAT";
    cashOutContractAddress: string | null;
    bankDetail: { accountName: string; accountNumber: string; bankCode: string } | null;
  };
  offRampJobs: { id: string }[];
};

function makePayout(
  overrides: Partial<MockPayout> & { employee: MockPayout["employee"] },
): MockPayout {
  return {
    id: "payout-1",
    employeeId: "emp-1",
    amountStroops: "10000000",
    offRampJobs: [],
    ...overrides,
    employee: overrides.employee,
  };
}

function makePrisma(run: {
  id: string;
  deploymentId: string;
  payouts: MockPayout[];
  deployment: { contractAddress: string | null };
}) {
  const created: Array<{ id: string; source: OffRampJobSource; sourceAddress: string | null }> = [];

  const prisma = {
    payrollRun: {
      findUnique: vi.fn().mockResolvedValue(run),
    },
    offRampPayoutJob: {
      create: vi.fn(
        async ({ data }: { data: { source: OffRampJobSource; sourceAddress: string | null } }) => {
          const job = { id: `job-${created.length + 1}`, ...data };
          created.push(job);
          return job;
        },
      ),
    },
  } as unknown as import("@prisma/client").PrismaClient;

  return { prisma, created };
}

describe("createOffRampJobsForPayrollRun", () => {
  const baseRun = {
    id: "run-1",
    deploymentId: "dep-1",
    deployment: { contractAddress: "CDeployment" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates CASH_OUT jobs for FIAT employees using their cash-out contract address", async () => {
    const run = {
      ...baseRun,
      payouts: [
        makePayout({
          id: "payout-fiat",
          amountStroops: "20000000",
          employee: {
            id: "emp-fiat",
            payoutMode: "FIAT",
            cashOutContractAddress: "CCashOutFiat",
            bankDetail: {
              accountName: "Juan Cruz",
              accountNumber: "0000042001461",
              bankCode: "BASECPH",
            },
          },
        }),
      ],
    };
    const { prisma, created } = makePrisma(run);

    const ids = await createOffRampJobsForPayrollRun(prisma, run.id);

    expect(ids).toHaveLength(1);
    expect(created[0]).toMatchObject({
      source: OffRampJobSource.CASH_OUT,
      sourceAddress: "CCashOutFiat",
      amountStroops: "20000000",
      bankAccountName: "Juan Cruz",
      bankAccountNumber: "0000042001461",
      bankCode: "BASECPH",
      status: OffRampPayoutJobStatus.PENDING,
    });
  });

  it("creates PAYROLL jobs for CRYPTO employees using the deployment contract address", async () => {
    const run = {
      ...baseRun,
      payouts: [
        makePayout({
          id: "payout-crypto",
          amountStroops: "15000000",
          employee: {
            id: "emp-crypto",
            payoutMode: "CRYPTO",
            cashOutContractAddress: null,
            bankDetail: {
              accountName: "Maria Cruz",
              accountNumber: "001700062270",
              bankCode: "BACTBPH",
            },
          },
        }),
      ],
    };
    const { prisma, created } = makePrisma(run);

    const ids = await createOffRampJobsForPayrollRun(prisma, run.id);

    expect(ids).toHaveLength(1);
    expect(created[0]).toMatchObject({
      source: OffRampJobSource.PAYROLL,
      sourceAddress: "CDeployment",
      amountStroops: "15000000",
    });
  });

  it("separates mixed crypto and fiat payouts into PAYROLL and CASH_OUT jobs", async () => {
    const run = {
      ...baseRun,
      payouts: [
        makePayout({
          id: "payout-crypto",
          employee: {
            id: "emp-crypto",
            payoutMode: "CRYPTO",
            cashOutContractAddress: null,
            bankDetail: {
              accountName: "Crypto",
              accountNumber: "001700062270",
              bankCode: "BACTBPH",
            },
          },
        }),
        makePayout({
          id: "payout-fiat",
          employee: {
            id: "emp-fiat",
            payoutMode: "FIAT",
            cashOutContractAddress: "CCashOutFiat",
            bankDetail: {
              accountName: "Fiat",
              accountNumber: "0000042001461",
              bankCode: "BASECPH",
            },
          },
        }),
      ],
    };
    const { prisma, created } = makePrisma(run);

    await createOffRampJobsForPayrollRun(prisma, run.id);

    expect(created).toHaveLength(2);
    const payroll = created.find((j) => j.source === OffRampJobSource.PAYROLL);
    const cashOut = created.find((j) => j.source === OffRampJobSource.CASH_OUT);
    expect(payroll?.sourceAddress).toBe("CDeployment");
    expect(cashOut?.sourceAddress).toBe("CCashOutFiat");
  });

  it("skips employees without bank details", async () => {
    const run = {
      ...baseRun,
      payouts: [
        makePayout({
          employee: {
            id: "emp-no-bank",
            payoutMode: "FIAT",
            cashOutContractAddress: "CCashOutNoBank",
            bankDetail: null,
          },
        }),
      ],
    };
    const { prisma, created } = makePrisma(run);

    const ids = await createOffRampJobsForPayrollRun(prisma, run.id);

    expect(ids).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("skips payouts that already have off-ramp jobs", async () => {
    const run = {
      ...baseRun,
      payouts: [
        makePayout({
          employee: {
            id: "emp-existing",
            payoutMode: "FIAT",
            cashOutContractAddress: "CCashOutExisting",
            bankDetail: {
              accountName: "Existing",
              accountNumber: "0000042001461",
              bankCode: "BASECPH",
            },
          },
          offRampJobs: [{ id: "job-existing" }],
        }),
      ],
    };
    const { prisma, created } = makePrisma(run);

    const ids = await createOffRampJobsForPayrollRun(prisma, run.id);

    expect(ids).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("throws when the payroll run is not found", async () => {
    const prisma = {
      payrollRun: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as import("@prisma/client").PrismaClient;

    await expect(createOffRampJobsForPayrollRun(prisma, "missing-run")).rejects.toThrow(
      "PayrollRun not found: missing-run",
    );
  });
});
