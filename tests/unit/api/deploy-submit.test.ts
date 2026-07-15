import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockDeploy, mockEnv, mockRedis, mockStreamer, mockFromXDR } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockDb)),
    deployment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      create: vi.fn(),
    },
    employeeBankDetail: {
      create: vi.fn(),
    },
    offRampSenderProfile: {
      upsert: vi.fn(),
    },
  };

  const mockDeploy = {
    submitDeployTx: vi.fn(),
  };

  const mockEnv = {
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    STELLAR_RELAYER_ADDRESS: null,
    LOG_LEVEL: "silent",
  };

  const mockRedis = {
    client: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
    eventChannel: vi.fn((id: string) => `events:${id}`),
  };

  const mockStreamer = {
    scheduleNextStreamerClaimJob: vi.fn(),
  };

  const mockFromXDR = vi.fn(() => ({
    hash: vi.fn(() => Buffer.from("aabbccdd", "hex")),
  }));

  return { mockDb, mockDeploy, mockEnv, mockRedis, mockStreamer, mockFromXDR };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/deploy", () => mockDeploy);
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  stellarRelayerAddress: () => mockEnv.STELLAR_RELAYER_ADDRESS,
  stellarPassphrase: () => mockEnv.STELLAR_NETWORK_PASSPHRASE,
}));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/redis", () => ({
  redis: () => mockRedis.client,
  eventChannel: mockRedis.eventChannel,
}));
vi.mock("@/lib/streamer-jobs", () => mockStreamer);
vi.mock("@stellar/stellar-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    TransactionBuilder: {
      fromXDR: mockFromXDR,
    },
  };
});

import { POST } from "@/app/api/deployments/[id]/submit/route";

function makeRequest({ deploymentId, signedXdr }: { deploymentId: string; signedXdr: string }) {
  return {
    json: async () => ({ signedXdr }),
  } as unknown as import("next/server").NextRequest;
}

function makeContext(deploymentId: string) {
  return { params: Promise.resolve({ id: deploymentId }) };
}

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status: "PENDING_SIGNATURE",
    deployTxHash: null,
    contractAddress: null,
    unsignedXdr: "unsigned-xdr",
    pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" }],
    paramsSnapshot: null,
    graphSnapshot: null,
    flow: { templateKind: "SPLITTER" },
    ...overrides,
  };
}

const TX_HASH = "aabbccdd";

function makePrismaError(code: string, message: string) {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

describe("deployments/[id]/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromXDR.mockImplementation(() => ({
      hash: vi.fn(() => Buffer.from("aabbccdd", "hex")),
    }));
  });

  it("returns idempotently when a concurrent request already confirmed (P2025 race-loser)", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CABC",
    });
    mockDb.deployment.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        makePrismaError("P2025", "An operation failed because it depends on one or more records"),
      );
    mockDb.deployment.findUnique.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: TX_HASH,
      contractAddress: "CABC",
      pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" }],
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe("CONFIRMED");
    expect(json.data.txHash).toBe(TX_HASH);
    expect(mockDb.deployment.update).toHaveBeenCalledTimes(2);
    expect(mockDb.deployment.findUnique).toHaveBeenCalledTimes(1);
  });

  it("throws CONFLICT when P2025 occurs with a different txHash", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CABC",
    });
    mockDb.deployment.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        makePrismaError("P2025", "An operation failed because it depends on one or more records"),
      );
    mockDb.deployment.findUnique.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: "different-hash",
      contractAddress: "CABC",
      pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" }],
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("CONFLICT");
  });

  it("rejects a signed XDR that does not match the prepared transaction", async () => {
    mockFromXDR.mockImplementation((...args: unknown[]) => ({
      hash: vi.fn(() => Buffer.from(args[0] === "unsigned-xdr" ? "aabbccdd" : "11223344", "hex")),
    }));
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "tampered-signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION");
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
    expect(mockDeploy.submitDeployTx).not.toHaveBeenCalled();
  });

  it("rejects when the deployment has no prepared transaction", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment({ unsignedXdr: null }));

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("CONFLICT");
    expect(mockDeploy.submitDeployTx).not.toHaveBeenCalled();
  });

  it("upserts the sender KYC profile from graphSnapshot.senderKyc on confirm", async () => {
    const pipelineSnapshot = [
      { nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" },
      { nodeId: "c1", contractAddress: "CDEF", templateKind: "CASH_OUT" },
    ];
    const senderKyc = {
      firstName: "Juan",
      lastName: "Dela Cruz",
      countryOrigin: "Philippines",
      sourceOfFunds: "Compensation",
    };
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment({ pipelineSnapshot }));
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CABC",
    });
    mockDb.deployment.update.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: TX_HASH,
      contractAddress: "CABC",
      pipelineSnapshot,
    });
    mockDb.deployment.findUnique.mockResolvedValue({
      graphSnapshot: { senderKyc },
      pipelineSnapshot,
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(200);
    expect(mockDb.offRampSenderProfile.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.offRampSenderProfile.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      create: { deploymentId: "dep-1", ...senderKyc },
      update: { ...senderKyc },
    });
  });

  it("skips the sender KYC upsert when graphSnapshot has no senderKyc", async () => {
    const pipelineSnapshot = [
      { nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" },
      { nodeId: "c1", contractAddress: "CDEF", templateKind: "CASH_OUT" },
    ];
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment({ pipelineSnapshot }));
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CABC",
    });
    mockDb.deployment.update.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: TX_HASH,
      contractAddress: "CABC",
      pipelineSnapshot,
    });
    mockDb.deployment.findUnique.mockResolvedValue({
      graphSnapshot: { nodes: [] },
      pipelineSnapshot,
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(200);
    expect(mockDb.offRampSenderProfile.upsert).not.toHaveBeenCalled();
  });

  it("skips the sender KYC upsert when the pipeline has no off-ramp node", async () => {
    const pipelineSnapshot = [{ nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" }];
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment({ pipelineSnapshot }));
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CABC",
    });
    mockDb.deployment.update.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: TX_HASH,
      contractAddress: "CABC",
      pipelineSnapshot,
    });
    mockDb.deployment.findUnique.mockResolvedValue({
      graphSnapshot: {
        senderKyc: {
          firstName: "Juan",
          lastName: "Dela Cruz",
          countryOrigin: "Philippines",
          sourceOfFunds: "Compensation",
        },
      },
      pipelineSnapshot,
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(200);
    expect(mockDb.offRampSenderProfile.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed signed XDR before touching the deployment", async () => {
    mockFromXDR.mockImplementation(() => {
      throw new Error("invalid XDR");
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "not-valid-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION");
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
  });
});
