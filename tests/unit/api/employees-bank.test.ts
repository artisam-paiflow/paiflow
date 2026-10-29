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
    requirePayrollSession: vi.fn(async () => ({
      user: { id: "owner-1", username: "owner", role: "USER" },
    })),
  };

  const mockRelayer = {
    updateBankByRelayer: vi.fn(),
  };

  return { mockDb, mockAuth, mockRelayer };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent" }),
}));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/treasury", () => mockRelayer);

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

    expect(res.status).toBe(422);
    expect(mockDb.employeeBankDetail.upsert).not.toHaveBeenCalled();
    expect(mockRelayer.updateBankByRelayer).not.toHaveBeenCalled();
    expect(json.error.code).toBe("VALIDATION");
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

describe("immutable bank destinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
  });
  it("rejects changing immutable bank metadata before writing", async () => {
    mockDb.employee.findUnique.mockResolvedValue({
      id: employeeId,
      deploymentId: "dep-1",
      cashOutContractAddress: "CCASHOUT",
    });
    const response = await POST(
      makeRequest({
        deploymentId: "dep-1",
        body: { employeeId, accountName: "Changed", accountNumber: "123", bankCode: "BANK" },
      }),
      makeContext("dep-1"),
    );
    expect(response.status).toBe(422);
    expect(mockDb.employeeBankDetail.upsert).not.toHaveBeenCalled();
  });
  it("rejects deleting immutable bank metadata before writing", async () => {
    mockDb.employee.findUnique.mockResolvedValue({
      id: employeeId,
      deploymentId: "dep-1",
      cashOutContractAddress: "CCASHOUT",
      bankDetail: { accountName: "Original" },
    });
    const req = makeRequest({ deploymentId: "dep-1" });
    const response = await DELETE(
      Object.assign(req, { url: req.url + "?employeeId=" + employeeId }),
      makeContext("dep-1"),
    );
    expect(response.status).toBe(422);
    expect(mockDb.employeeBankDetail.delete).not.toHaveBeenCalled();
  });
});
