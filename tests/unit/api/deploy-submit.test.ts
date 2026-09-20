import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockDeploy, mockEnv, mockRedis, mockStreamer, mockFromXDR, fakeTx } = vi.hoisted(
  () => {
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
      signedTransaction: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const mockDeploy = {
      submitDeployTx: vi.fn(),
    };

    const mockEnv = {
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      STELLAR_RELAYER_ADDRESS: null as string | null,
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

    // The shape `lib/stellar/signer.ts` reads off a parsed envelope: a source
    // account and a signature list, plus the hash the route compares.
    const fakeTx = (hashHex: string) => ({
      source: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      signatures: [],
      hash: vi.fn(() => Buffer.from(hashHex, "hex")),
    });
    const mockFromXDR = vi.fn(() => fakeTx("aabbccdd"));

    return { mockDb, mockDeploy, mockEnv, mockRedis, mockStreamer, mockFromXDR, fakeTx };
  },
);

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/stellar/deploy", () => mockDeploy);
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  stellarRelayerAddress: () => mockEnv.STELLAR_RELAYER_ADDRESS,
  stellarPassphrase: () => mockEnv.STELLAR_NETWORK_PASSPHRASE,
}));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn(async () => undefined) }));
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
import { audit } from "@/lib/audit";
import { captureServer } from "@/lib/analytics/server";

const auditActions = () => vi.mocked(audit).mock.calls.map(([a]) => a.action);
const capturedEvents = () => vi.mocked(captureServer).mock.calls.map(([, event]) => event);

function makeRequest({ deploymentId, signedXdr }: { deploymentId: string; signedXdr: string }) {
  return {
    json: async () => ({ signedXdr }),
    headers: new Headers({ "x-forwarded-for": "203.0.113.9" }),
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
    mockFromXDR.mockImplementation(() => fakeTx("aabbccdd"));
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

  it("refuses a concurrent duplicate: the PENDING_SIGNATURE claim fails before the chain call", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDb.deployment.update.mockRejectedValueOnce(
      makePrismaError("P2025", "An operation failed because it depends on one or more records"),
    );

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("CONFLICT");
    expect(mockDb.deployment.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "dep-1", status: "PENDING_SIGNATURE" },
    });
    expect(mockDeploy.submitDeployTx).not.toHaveBeenCalled();
    expect(mockDb.signedTransaction.createMany).not.toHaveBeenCalled();
  });

  it("marks FAILED only while still SUBMITTED, so a confirmed deployment is never overwritten", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "FAILED",
      txHash: TX_HASH,
      errorMessage: "tx failed",
    });
    mockDb.deployment.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        makePrismaError("P2025", "An operation failed because it depends on one or more records"),
      );

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(502);
    expect(mockDb.deployment.update.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { id: "dep-1", status: "SUBMITTED" },
      data: { status: "FAILED" },
    });
  });

  // #557: TRY_AGAIN_LATER means the network never queued the transaction.
  describe("a send the network did not accept", () => {
    it("hands the claim back: PENDING_SIGNATURE, no hash, no DEPLOY_FAIL, 502", async () => {
      mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
      mockDeploy.submitDeployTx.mockResolvedValue({ status: "NOT_ACCEPTED" });
      mockDb.deployment.update.mockResolvedValue(undefined);

      const res = await POST(
        makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" }),
        makeContext("dep-1"),
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error.code).toBe("UPSTREAM_RPC");
      expect(json.error.message).toContain("submit the same envelope again");
      expect(mockDb.deployment.update).toHaveBeenCalledTimes(2);
      expect(mockDb.deployment.update.mock.calls.at(-1)?.[0]).toEqual({
        where: { id: "dep-1", status: "SUBMITTED" },
        data: { status: "PENDING_SIGNATURE" },
      });
      expect(auditActions()).toEqual(["DEPLOY_SUBMIT"]);
      expect(capturedEvents()).not.toContain("deploy_failed");
    });

    it("the same signed envelope can then be submitted again and confirm", async () => {
      mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
      mockDb.deployment.update.mockResolvedValue({
        id: "dep-1",
        status: "CONFIRMED",
        deployTxHash: TX_HASH,
        contractAddress: "CABC",
        pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CABC", templateKind: "SPLITTER" }],
      });
      // The signer row is keyed on the hash: created once, skipped on the retry.
      mockDb.signedTransaction.createMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockDeploy.submitDeployTx
        .mockResolvedValueOnce({ status: "NOT_ACCEPTED" })
        .mockResolvedValueOnce({ status: "SUCCESS", txHash: TX_HASH, contractAddress: "CABC" });

      const first = await POST(
        makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" }),
        makeContext("dep-1"),
      );
      const second = await POST(
        makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" }),
        makeContext("dep-1"),
      );

      expect(first.status).toBe(502);
      expect(second.status).toBe(200);
      expect((await second.json()).data).toMatchObject({ status: "CONFIRMED", txHash: TX_HASH });
      expect(mockDeploy.submitDeployTx).toHaveBeenCalledTimes(2);
      expect(auditActions()).toEqual(["DEPLOY_SUBMIT", "DEPLOY_SUBMIT", "DEPLOY_CONFIRM"]);
      expect(capturedEvents().filter((e) => e === "transaction_signed")).toHaveLength(1);
      expect(capturedEvents()).not.toContain("deploy_failed");
    });

    it("still answers 502 when the row stopped being SUBMITTED in the meantime", async () => {
      mockDb.deployment.findFirst.mockResolvedValue(makeDeployment());
      mockDeploy.submitDeployTx.mockResolvedValue({ status: "NOT_ACCEPTED" });
      mockDb.deployment.update
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(makePrismaError("P2025", "No record was found for an update"));

      const res = await POST(
        makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" }),
        makeContext("dep-1"),
      );

      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe("UPSTREAM_RPC");
      expect(auditActions()).toEqual(["DEPLOY_SUBMIT"]);
    });
  });

  it("rejects a signed XDR that does not match the prepared transaction", async () => {
    mockFromXDR.mockImplementation((...args: unknown[]) =>
      fakeTx(args[0] === "unsigned-xdr" ? "aabbccdd" : "11223344"),
    );
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

  it("sets chargeEndAt from the subscription schedule node's endTs on confirm", async () => {
    const startTs = Math.floor(Date.now() / 1000) + 3600;
    const endTs = startTs + 7200;
    mockEnv.STELLAR_RELAYER_ADDRESS = "GRELAYER";
    try {
      mockDb.deployment.findFirst.mockResolvedValue(
        makeDeployment({
          flow: { templateKind: "SUBSCRIPTION" },
          pipelineSnapshot: [
            { nodeId: "n1", contractAddress: "CSUB", templateKind: "SUBSCRIPTION" },
          ],
          paramsSnapshot: [
            {
              nodeId: "n1",
              templateKind: "SUBSCRIPTION",
              params: { kind: "subscription_trigger", relayer: "GRELAYER", startTs, endTs },
            },
          ],
        }),
      );
      mockDeploy.submitDeployTx.mockResolvedValue({
        status: "SUCCESS",
        txHash: TX_HASH,
        contractAddress: "CSUB",
      });
      mockDb.deployment.update.mockResolvedValue({
        id: "dep-1",
        status: "CONFIRMED",
        deployTxHash: TX_HASH,
        contractAddress: "CSUB",
        pipelineSnapshot: [{ nodeId: "n1", contractAddress: "CSUB", templateKind: "SUBSCRIPTION" }],
      });

      const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
      const res = await POST(req, makeContext("dep-1"));

      expect(res.status).toBe(200);
      const confirmCall = mockDb.deployment.update.mock.calls.at(-1)?.[0] as {
        data: Record<string, unknown>;
      };
      expect(confirmCall.data.chargeEndAt).toEqual(new Date(endTs * 1000));
      expect(confirmCall.data.nextChargeAt).toEqual(new Date(startTs * 1000));
      expect(confirmCall.data.chargeRelayerMode).toBe("PLATFORM");
      expect(confirmCall.data.chargeRelayerAddress).toBe("GRELAYER");
    } finally {
      mockEnv.STELLAR_RELAYER_ADDRESS = null;
    }
  });

  it("sets chargeEndAt for a payroll flow whose schedule node is SUBSCRIPTION_DEV", async () => {
    const startTs = 1_784_174_000;
    const endTs = 1_784_999_999;
    mockDb.deployment.findFirst.mockResolvedValue(
      makeDeployment({
        flow: { templateKind: "PAYROLL" },
        pipelineSnapshot: [
          { nodeId: "n1", contractAddress: "CSUBDEV", templateKind: "SUBSCRIPTION_DEV" },
          { nodeId: "n2", contractAddress: "CSPLIT", templateKind: "SPLITTER_DEV" },
        ],
        paramsSnapshot: [
          {
            nodeId: "n1",
            templateKind: "SUBSCRIPTION_DEV",
            params: { kind: "subscription_dev_trigger", relayer: "GOTHER", startTs, endTs },
          },
          {
            nodeId: "n2",
            templateKind: "SPLITTER_DEV",
            params: { kind: "splitter_dev", recipients: [] },
          },
        ],
      }),
    );
    mockDeploy.submitDeployTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: TX_HASH,
      contractAddress: "CSUBDEV",
    });
    mockDb.deployment.update.mockResolvedValue({
      id: "dep-1",
      status: "CONFIRMED",
      deployTxHash: TX_HASH,
      contractAddress: "CSUBDEV",
      pipelineSnapshot: [
        { nodeId: "n1", contractAddress: "CSUBDEV", templateKind: "SUBSCRIPTION_DEV" },
      ],
    });

    const req = makeRequest({ deploymentId: "dep-1", signedXdr: "signed-xdr" });
    const res = await POST(req, makeContext("dep-1"));

    expect(res.status).toBe(200);
    const confirmCall = mockDb.deployment.update.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>;
    };
    expect(confirmCall.data.chargeEndAt).toEqual(new Date(endTs * 1000));
    // Relayer does not match the (unset) platform relayer, so charges stay manual.
    expect(confirmCall.data.chargeRelayerMode).toBe("MANUAL");
  });
});
