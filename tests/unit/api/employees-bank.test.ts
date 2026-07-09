import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockAuth, mockRelayer } = vi.hoisted(() => {
  const mockDb = {
    deployment: {
      findFirst: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    employeeBankDetail: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };

  const mockAuth = {
    requireDevAuth: vi.fn(async () => ({ user: null })),
  };

  const mockRelayer = {
    updateBankByRelayer: vi.fn(),
  };

  return { mockDb, mockAuth, mockRelayer };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => ({ DEV_API_SECRET: "dev-secret", LOG_LEVEL: "silent" }),
}));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/dev-mutate", () => mockRelayer);

import { GET, POST, DELETE } from "@/app/api/deployments/[id]/employees/bank/route";

const employeeId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const cryptoAddress = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function makeRequest({
  deploymentId,
  body,
  secret = "dev-secret",
}: {
  deploymentId: string;
  body?: unknown;
  secret?: string;
}) {
  return {
    headers: {
      get: (name: string) =>
        name === "x-dev-api-secret" ? secret : name === "content-type" ? "application/json" : null,
    },
    json: async () => body,
    url: `http://localhost/api/deployments/${deploymentId}/employees/bank`,
  } as unknown as import("next/server").NextRequest;
}

function makeContext(deploymentId: string) {
  return { params: Promise.resolve({ id: deploymentId }) };
}

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    flow: { templateKind: "PAYROLL" },
    ...overrides,
  };
}

describe("employees/bank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET lists employees including their ids", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findMany.mockResolvedValue([
      {
        id: "emp-1",
        address: cryptoAddress,
        payoutMode: "CRYPTO",
        cashOutContractAddress: null,
        bankDetail: null,
      },
    ]);

    const res = await GET(makeRequest({ deploymentId: "dep-1" }), makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([
      {
        id: "emp-1",
        address: cryptoAddress,
        payoutMode: "CRYPTO",
        cashOutContractAddress: null,
        bankDetail: null,
      },
    ]);
  });

  it("POST upserts bank details by address", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1", payoutMode: "CRYPTO" });
    mockDb.employeeBankDetail.upsert.mockResolvedValue({
      id: "bd-1",
      employeeId: "emp-1",
      accountName: "Test",
      accountNumber: "123",
      bankCode: "BPI",
    });

    const res = await POST(
      makeRequest({
        deploymentId: "dep-1",
        body: {
          address: cryptoAddress,
          accountName: "Test",
          accountNumber: "123",
          bankCode: "BPI",
        },
      }),
      makeContext("dep-1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.employeeId).toBe("emp-1");
    expect(mockDb.employee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deploymentId_address: { deploymentId: "dep-1", address: cryptoAddress } },
      }),
    );
  });

  it("POST updates bank details by employeeId", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findUnique.mockResolvedValue({
      id: employeeId,
      deploymentId: "dep-1",
      payoutMode: "CRYPTO",
    });
    mockDb.employeeBankDetail.upsert.mockResolvedValue({
      id: "bd-1",
      employeeId,
      accountName: "By Id",
      accountNumber: "456",
      bankCode: "BDO",
    });

    const res = await POST(
      makeRequest({
        deploymentId: "dep-1",
        body: {
          employeeId,
          accountName: "By Id",
          accountNumber: "456",
          bankCode: "BDO",
        },
      }),
      makeContext("dep-1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.employeeId).toBe(employeeId);
    expect(mockDb.employee.findUnique).toHaveBeenCalledWith({ where: { id: employeeId } });
    expect(mockDb.employee.upsert).not.toHaveBeenCalled();
  });

  it("POST rejects a body with both employeeId and address", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());

    const res = await POST(
      makeRequest({
        deploymentId: "dep-1",
        body: {
          employeeId: "emp-1",
          address: cryptoAddress,
          accountName: "Test",
          accountNumber: "123",
          bankCode: "BPI",
        },
      }),
      makeContext("dep-1"),
    );

    expect(res.status).toBe(422);
  });

  it("POST mirrors bank details to the on-chain cash-out contract for fiat employees", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findUnique.mockResolvedValue({
      id: employeeId,
      deploymentId: "dep-1",
      payoutMode: "FIAT",
      cashOutContractAddress: "CCashOut",
    });
    mockRelayer.updateBankByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-bank",
    });
    mockDb.employeeBankDetail.upsert.mockResolvedValue({
      id: "bd-1",
      employeeId,
      accountName: "Fiat",
      accountNumber: "789",
      bankCode: "METRO",
    });

    const res = await POST(
      makeRequest({
        deploymentId: "dep-1",
        body: {
          employeeId,
          accountName: "Fiat",
          accountNumber: "789",
          bankCode: "METRO",
        },
      }),
      makeContext("dep-1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockRelayer.updateBankByRelayer).toHaveBeenCalledWith("CCashOut", {
      accountName: "Fiat",
      accountNumber: "789",
      bankCode: "METRO",
    });
    expect(json.data.cashOutTxHash).toBe("tx-bank");
  });

  it("DELETE removes bank details by employeeId", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findUnique.mockResolvedValue({
      id: employeeId,
      deploymentId: "dep-1",
      bankDetail: { id: "bd-1" },
    });

    const req = {
      ...makeRequest({ deploymentId: "dep-1" }),
      url: `http://localhost/api/deployments/dep-1/employees/bank?employeeId=${employeeId}`,
    } as unknown as import("next/server").NextRequest;

    const res = await DELETE(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(mockDb.employeeBankDetail.delete).toHaveBeenCalledWith({ where: { employeeId } });
  });

  it("DELETE still works by address", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      deploymentId: "dep-1",
      bankDetail: { id: "bd-1" },
    });

    const req = {
      ...makeRequest({ deploymentId: "dep-1" }),
      url: `http://localhost/api/deployments/dep-1/employees/bank?address=${encodeURIComponent(cryptoAddress)}`,
    } as unknown as import("next/server").NextRequest;

    const res = await DELETE(req, makeContext("dep-1"));

    expect(res.status).toBe(200);
    expect(mockDb.employee.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deploymentId_address: { deploymentId: "dep-1", address: cryptoAddress } },
      }),
    );
  });
});
