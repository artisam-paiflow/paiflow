import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockEnv, mockAuth, mockRelayer } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn((fn: unknown) =>
      typeof fn === "function" ? fn(mockDb) : Promise.resolve(),
    ),
    deployment: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    employeeBankDetail: {
      upsert: vi.fn(),
    },
  };

  const mockEnv = {
    DEV_API_SECRET: "dev-secret",
    LOG_LEVEL: "silent",
    STELLAR_NETWORK: "testnet",
  };

  const mockAuth = {
    requireDevAuth: vi.fn(async () => ({ user: null })),
  };

  const mockRelayer = {
    updateRecipientsByRelayer: vi.fn(),
    submitUpdateRecipientsByRelayer: vi.fn(),
    deployCashOutDevByRelayer: vi.fn(),
    updateBankByRelayer: vi.fn(),
  };

  return { mockDb, mockEnv, mockAuth, mockRelayer };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  stellarPassphrase: () => "Test SDF Network ; September 2015",
  offRampTreasuryAddress: () => undefined,
}));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/dev-mutate", () => mockRelayer);

import { POST } from "@/app/api/deployments/[id]/dev-splitter/route";

function makeRequest({
  deploymentId,
  body,
  secret = "dev-secret",
}: {
  deploymentId: string;
  body: unknown;
  secret?: string;
}) {
  return {
    headers: {
      get: (name: string) =>
        name === "x-dev-api-secret" ? secret : name === "content-type" ? "application/json" : null,
    },
    json: async () => body,
  } as unknown as import("next/server").NextRequest;
}

function makeContext(deploymentId: string) {
  return { params: Promise.resolve({ id: deploymentId }) };
}

const cryptoAddress = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const fiatAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const splitterAddress = "CSplitter";
const cashOutAddress = "CCashOut";

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status: "CONFIRMED",
    sourceAccount: "GSource",
    graphSnapshot: {
      nodes: [
        {
          id: "split-1",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [],
    },
    pipelineSnapshot: [
      { nodeId: "split-1", contractAddress: splitterAddress, templateKind: "SPLITTER_DEV" },
    ],
    ...overrides,
  };
}

describe("dev-splitter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates crypto-only recipients synchronously", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockRelayer.updateRecipientsByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-crypto",
    });

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [{ address: cryptoAddress, mode: "fixed", amountStroops: "5000000" }],
      },
    });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.txHash).toBe("tx-crypto");
    expect(json.data.txHashes).toEqual(["tx-crypto"]);
    expect(json.data.contractAddress).toBe(splitterAddress);
    expect(json.data.cashOutContracts).toEqual({});
    expect(mockRelayer.updateRecipientsByRelayer).toHaveBeenCalledWith(splitterAddress, [
      { address: cryptoAddress, bps: 0, amount: "5000000", isCashOut: false },
    ]);
    expect(mockRelayer.deployCashOutDevByRelayer).not.toHaveBeenCalled();
  });

  it("deploys a CASH_OUT_DEV contract for a fiat recipient", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findMany.mockResolvedValue([]);
    mockRelayer.deployCashOutDevByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-deploy",
      contractAddress: cashOutAddress,
    });
    mockRelayer.submitUpdateRecipientsByRelayer.mockResolvedValue({
      status: "PENDING",
      txHash: "tx-splitter",
    });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [
          {
            address: fiatAddress,
            mode: "fixed",
            amountStroops: "5000000",
            payoutMode: "fiat",
            bankDetail: {
              accountName: "Test User",
              accountNumber: "1234567890",
              bankCode: "BPI",
            },
          },
        ],
      },
    });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.txHashes).toEqual(["tx-deploy", "tx-splitter"]);
    expect(json.data.cashOutContracts).toEqual({ [fiatAddress]: cashOutAddress });
    expect(mockRelayer.deployCashOutDevByRelayer).toHaveBeenCalledWith(
      expect.objectContaining({
        adminAddress: "GSource",
        parent: splitterAddress,
        accountName: "Test User",
        accountNumber: "1234567890",
        bankCode: "BPI",
      }),
    );
    expect(mockRelayer.submitUpdateRecipientsByRelayer).toHaveBeenCalledWith(splitterAddress, [
      { address: cashOutAddress, bps: 0, amount: "5000000", isCashOut: true },
    ]);
    expect(mockDb.employee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          address: fiatAddress,
          payoutMode: "FIAT",
          cashOutContractAddress: cashOutAddress,
        }),
      }),
    );
  });

  it("reuses an existing cash-out contract and updates bank details", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findMany.mockResolvedValue([
      { address: fiatAddress, cashOutContractAddress: cashOutAddress },
    ]);
    mockRelayer.updateBankByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-bank",
    });
    mockRelayer.submitUpdateRecipientsByRelayer.mockResolvedValue({
      status: "PENDING",
      txHash: "tx-splitter",
    });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [
          {
            address: fiatAddress,
            mode: "fixed",
            amountStroops: "7000000",
            payoutMode: "fiat",
            bankDetail: {
              accountName: "Updated User",
              accountNumber: "0987654321",
              bankCode: "BDO",
            },
          },
        ],
      },
    });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.txHashes).toEqual(["tx-bank", "tx-splitter"]);
    expect(mockRelayer.deployCashOutDevByRelayer).not.toHaveBeenCalled();
    expect(mockRelayer.updateBankByRelayer).toHaveBeenCalledWith(cashOutAddress, {
      accountName: "Updated User",
      accountNumber: "0987654321",
      bankCode: "BDO",
    });
  });

  it("handles mixed crypto + fiat recipients", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.employee.findMany.mockResolvedValue([]);
    mockRelayer.deployCashOutDevByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-deploy",
      contractAddress: cashOutAddress,
    });
    mockRelayer.submitUpdateRecipientsByRelayer.mockResolvedValue({
      status: "PENDING",
      txHash: "tx-splitter",
    });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [
          { address: cryptoAddress, mode: "fixed", amountStroops: "3000000" },
          {
            address: fiatAddress,
            mode: "fixed",
            amountStroops: "7000000",
            payoutMode: "fiat",
            bankDetail: {
              accountName: "Test User",
              accountNumber: "1234567890",
              bankCode: "BPI",
            },
          },
        ],
      },
    });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.txHashes).toEqual(["tx-deploy", "tx-splitter"]);
    expect(mockRelayer.submitUpdateRecipientsByRelayer).toHaveBeenCalledWith(
      splitterAddress,
      expect.arrayContaining([
        { address: cryptoAddress, bps: 0, amount: "3000000", isCashOut: false },
        { address: cashOutAddress, bps: 0, amount: "7000000", isCashOut: true },
      ]),
    );
  });

  it("rejects fiat recipients missing bank details", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [
          {
            address: fiatAddress,
            mode: "fixed",
            amountStroops: "5000000",
            payoutMode: "fiat",
          },
        ],
      },
    });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects fiat recipients in percentage mode", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());

    const req = makeRequest({
      deploymentId: "dep-1",
      body: {
        recipients: [
          {
            address: fiatAddress,
            mode: "percentage",
            bps: 5000,
            payoutMode: "fiat",
            bankDetail: {
              accountName: "Test User",
              accountNumber: "1234567890",
              bankCode: "BPI",
            },
          },
        ],
      },
    });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
  });

  it("returns 404 for a missing deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);

    const req = makeRequest({
      deploymentId: "dep-missing",
      body: {
        recipients: [{ address: cryptoAddress, mode: "fixed", amountStroops: "1000" }],
      },
    });
    const res = await POST(req, makeContext("dep-missing"));

    expect(res.status).toBe(404);
  });
});
