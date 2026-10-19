import { Keypair } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const { db, deploy, relayer } = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(),
    flow: { create: vi.fn(), delete: vi.fn() },
    deployment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  };
  return { db, deploy: vi.fn(), relayer: { address: "", secret: "" } };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/auth", () => ({ requireDevApiToken: async () => ({ id: "owner" }) }));
vi.mock("@/lib/features", () => ({ requireFeature: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: () => ({ STELLAR_NETWORK: "testnet", LOG_LEVEL: "silent" }),
  stellarRelayerAddress: () => relayer.address,
  stellarRelayerSecretKey: () => relayer.secret,
  offRampTreasuryAddress: () => undefined,
}));
vi.mock("@/lib/stellar/config", () => ({
  getWasmHashes: async () =>
    new Map([
      ["SUBSCRIPTION_DEV", "a".repeat(64)],
      ["SPLITTER_DEV", "b".repeat(64)],
    ]),
}));
vi.mock("@/lib/stellar/deploy", () => ({
  deployPipelineByRelayer: deploy,
  checkAccountFunding: vi.fn(),
}));
vi.mock("@/lib/deployments/service-work", () => ({
  withDeploymentWork: async (_id: string, _kind: string, work: () => Promise<unknown>) => work(),
}));
import { POST } from "@/app/api/deployments/dev-payroll/route";
function request() {
  return {
    json: async () => ({
      idempotencyKey: "original-key",
      sourceAccount: relayer.address,
      asset: "XLM",
      network: "testnet",
      intervalUnit: "day",
      firstPaymentAt: "2030-01-01T00:00:00Z",
      amountPerPeriodStroops: "100",
    }),
  } as NextRequest;
}
beforeEach(() => {
  vi.resetAllMocks();
  const key = Keypair.random();
  relayer.address = key.publicKey();
  relayer.secret = key.secret();
  db.deployment.findUnique.mockResolvedValue(null);
  db.deployment.create.mockResolvedValue({ id: "deployment", serviceState: "ACTIVE" });
  db.deployment.update.mockResolvedValue({});
  db.flow.create.mockResolvedValue({ id: "flow" });
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
});
it.each(["deadline", "transport"])(
  "keeps %s uncertainty BUILDING using the failure code",
  async (kind) => {
    deploy.mockResolvedValue({
      status: "FAILED",
      txHash: "a".repeat(64),
      failureCode: "FINALITY_UNKNOWN",
      errorMessage:
        kind === "deadline"
          ? "Timeout wording may change"
          : "Confirmation is pending; check the original transaction hash",
      pipeline: [],
    });
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({
      status: "BUILDING",
      deployTxHash: "a".repeat(64),
    });
    expect(db.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deployTxHash: "a".repeat(64) }) }),
    );
    expect(db.deployment.update.mock.calls.some(([arg]) => arg.data.status === "FAILED")).toBe(
      false,
    );
  },
);
it("replays a stale BUILDING deployment with a hash without deleting or redeploying", async () => {
  db.deployment.findUnique.mockResolvedValue({
    id: "deployment",
    serviceState: "ACTIVE",
    status: "BUILDING",
    deployTxHash: "a".repeat(64),
    createdAt: new Date(0),
    network: "testnet",
    pipelineSnapshot: [],
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    status: "BUILDING",
    deployTxHash: "a".repeat(64),
  });
  expect(db.deployment.delete).not.toHaveBeenCalled();
  expect(db.flow.delete).not.toHaveBeenCalled();
  expect(deploy).not.toHaveBeenCalled();
});
it("retains explicit rejection as a failure", async () => {
  deploy.mockResolvedValue({
    status: "FAILED",
    txHash: "a".repeat(64),
    failureCode: "RPC_REJECTED",
    errorMessage: "Rejected",
    pipeline: [],
  });
  expect((await POST(request())).status).toBe(502);
  expect(db.deployment.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
  );
});
