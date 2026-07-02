import { describe, it, expect, vi, beforeEach } from "vitest";
import { OffRampJobSource, OffRampPayoutJobStatus } from "@prisma/client";
import { createOffRampJobsForPayrollRun, claimOffRampJob } from "@/lib/offramp/jobs";

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

/**
 * Models the DB's single-statement atomic CAS: updateMany matches on the exact
 * (id, status, lockedAt) and mutates the row in one indivisible step. Because
 * the mock body has no internal await, JS run-to-completion makes each call
 * apply fully before the next observes it — the same guarantee the real
 * `UPDATE ... WHERE` gives, so overlapping claimants race realistically.
 */
function makeClaimPrisma(initial: {
  id: string;
  status: OffRampPayoutJobStatus;
  lockedAt: Date | null;
}) {
  let row = { ...initial };
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; status: OffRampPayoutJobStatus; lockedAt?: Date | null };
      data: { status?: OffRampPayoutJobStatus; lockedAt?: Date | null };
    }) => {
      const lockedAtMatches =
        where.lockedAt === undefined
          ? true
          : where.lockedAt === null
            ? row.lockedAt === null
            : row.lockedAt?.getTime() === where.lockedAt.getTime();
      const matches = row.id === where.id && row.status === where.status && lockedAtMatches;
      if (!matches) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
  );

  const prisma = {
    offRampPayoutJob: { updateMany },
  } as unknown as import("@prisma/client").PrismaClient;

  return { prisma, updateMany, getRow: () => row };
}

describe("claimOffRampJob", () => {
  it("claims a PENDING job via a status CAS and stamps lockedAt", async () => {
    const { prisma, updateMany, getRow } = makeClaimPrisma({
      id: "job-1",
      status: OffRampPayoutJobStatus.PENDING,
      lockedAt: null,
    });

    const won = await claimOffRampJob(prisma, "job-1", OffRampPayoutJobStatus.PENDING, null);

    expect(won).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", status: OffRampPayoutJobStatus.PENDING },
        data: expect.objectContaining({ status: OffRampPayoutJobStatus.RUNNING }),
      }),
    );
    expect(getRow().status).toBe(OffRampPayoutJobStatus.RUNNING);
    expect(getRow().lockedAt).toBeInstanceOf(Date);
  });

  it("loses the PENDING claim once the job already advanced", async () => {
    const { prisma } = makeClaimPrisma({
      id: "job-1",
      status: OffRampPayoutJobStatus.RUNNING, // already claimed by someone else
      lockedAt: new Date(),
    });

    const won = await claimOffRampJob(prisma, "job-1", OffRampPayoutJobStatus.PENDING, null);

    expect(won).toBe(false);
  });

  it("re-claims a stale RUNNING job via an exact-lockedAt CAS", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const { prisma, updateMany, getRow } = makeClaimPrisma({
      id: "job-1",
      status: OffRampPayoutJobStatus.RUNNING,
      lockedAt: stale,
    });

    const won = await claimOffRampJob(prisma, "job-1", OffRampPayoutJobStatus.RUNNING, stale);

    expect(won).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", status: OffRampPayoutJobStatus.RUNNING, lockedAt: stale },
        data: expect.objectContaining({ lockedAt: expect.any(Date) }),
      }),
    );
    // Lease was refreshed to a newer timestamp.
    expect(getRow().lockedAt).not.toBe(stale);
    expect(getRow().lockedAt!.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("lets only ONE of two overlapping runs re-claim the same RUNNING job", async () => {
    // Regression for the RUNNING->RUNNING no-op race: both runs read the job as
    // RUNNING with the same stale lockedAt and try to claim it. Exactly one must
    // win, or both would call depositNativeToProvider (double XLM deposit).
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const { prisma } = makeClaimPrisma({
      id: "job-1",
      status: OffRampPayoutJobStatus.RUNNING,
      lockedAt: stale,
    });

    const [a, b] = await Promise.all([
      claimOffRampJob(prisma, "job-1", OffRampPayoutJobStatus.RUNNING, stale),
      claimOffRampJob(prisma, "job-1", OffRampPayoutJobStatus.RUNNING, stale),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
