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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  db: { deployment: { findFirst: vi.fn() } },
  rpc: {
    getAccount: vi.fn(),
    _getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
    simulateTransaction: vi.fn(),
    getTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  },
  subscriber: vi.fn(),
  asset: vi.fn(),
  cancelled: vi.fn(),
  allowance: vi.fn(),
  audit: vi.fn(),
  record: vi.fn(),
  rateLimit: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: mocks.session }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mocks.rpc,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
  withRelayerLock: async (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/stellar/relayer", () => ({
  readSubscriptionSubscriberNullable: mocks.subscriber,
  readSubscriptionAsset: mocks.asset,
  readSubscriptionIsCancelled: mocks.cancelled,
  readTokenAllowance: mocks.allowance,
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.rateLimit,
  clientIp: () => "203.0.113.1",
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit, needsSubmitRow: async () => true }));
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: mocks.record }));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(),
  recordTransactionOutcome: vi.fn(),
}));
import { GET, POST } from "@/app/api/deployments/[id]/subscription-allowance/route";
import { POST as submit } from "@/app/api/deployments/[id]/subscription-allowance/submit/route";
import { assetContractId } from "@/lib/stellar/assets";
import { AppError } from "@/lib/errors";
import { paymentAccountResponse } from "../stellar/payment-account-fixture";
import { MAX_ALLOWANCE } from "@/lib/subscription/schema";

const id = "11111111-1111-4111-8111-111111111111";
const customer = Keypair.random();
const originalSubscriber = Keypair.random().publicKey();
const spender = StrKey.encodeContract(Buffer.alloc(32, 2));
const token = assetContractId({ kind: "native" });
const ctx = { params: Promise.resolve({ id }) };
const graph = {
  nodes: [
    {
      id: "sub",
      type: "subscription",
      config: {
        subscriber: originalSubscriber,
        asset: { kind: "native" },
        amountPerPeriodStroops: "100",
      },
    },
  ],
  edges: [],
};
function deployment(kind = "SUBSCRIPTION") {
  return {
    id,
    network: "testnet",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    flow: { name: "Club", templateKind: "SUBSCRIPTION" },
    graphSnapshot: structuredClone(graph),
    pipelineSnapshot: [{ nodeId: "sub", templateKind: kind, contractAddress: spender }],
  };
}
function request(body?: unknown) {
  return new NextRequest(
    `https://paiflow.test/api/deployments/${id}/subscription-allowance`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
async function prepare() {
  const response = await POST(request({ amount: "200", userAddress: customer.publicKey() }), ctx);
  expect(response.status).toBe(200);
  return (await response.json()).data as {
    xdr: string;
    intent: string;
    txHash: string;
    allowance: string;
  };
}
function sign(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  tx.sign(customer);
  return tx.toXDR();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.deployment.findFirst.mockResolvedValue(deployment());
  mocks.subscriber.mockResolvedValue(customer.publicKey());
  mocks.asset.mockResolvedValue(token);
  mocks.cancelled.mockResolvedValue(false);
  mocks.allowance.mockResolvedValue(100n);
  mocks.session.mockResolvedValue(null);
  mocks.rpc._getLedgerEntries.mockResolvedValue(paymentAccountResponse(customer.publicKey()));
  mocks.rpc.getAccount.mockImplementation(async () => new Account(customer.publicKey(), "1"));
  mocks.rpc.getLatestLedger.mockResolvedValue({ sequence: 1000 });
  mocks.rpc.simulateTransaction.mockResolvedValue({
    _parsed: true,
    id: "1",
    latestLedger: 1000,
    events: [],
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "1000",
    result: { auth: [], retval: nativeToScVal(true) },
  });
  mocks.rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.rpc.sendTransaction.mockImplementation(async (tx: Transaction) => ({
    status: "PENDING",
    hash: tx.hash().toString("hex"),
  }));
});

describe("anonymous subscription allowance journey", () => {
  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"])(
    "reads, prepares and submits %s with the current subscriber",
    async (kind) => {
      mocks.db.deployment.findFirst.mockResolvedValue(deployment(kind));
      const read = await GET(request(), ctx);
      expect(read.status).toBe(200);
      expect((await read.json()).data).toMatchObject({
        subscriber: customer.publicKey(),
        allowance: "100",
        contractAddress: spender,
        tokenContractAddress: token,
        setupRequired: false,
      });
      const prepared = await prepare();
      expect(prepared.allowance).toBe("300");
      const response = await submit(
        request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }),
        ctx,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ txHash: prepared.txHash, status: "PENDING" });
      expect(mocks.allowance).toHaveBeenCalledWith({
        tokenContractAddress: token,
        owner: customer.publicKey(),
        spender,
        classifyRpcFailures: true,
      });
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          signer: expect.objectContaining({
            signerAddress: customer.publicKey(),
            signedBySource: true,
          }),
        }),
      );
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          metadata: expect.objectContaining({
            signerAddress: customer.publicKey(),
            txHash: prepared.txHash,
          }),
        }),
      );
      expect(mocks.rpc.sendTransaction).toHaveBeenCalledOnce();
    },
  );
  it("shows setup state and refuses an unconfigured Dev subscriber", async () => {
    mocks.db.deployment.findFirst.mockResolvedValue(deployment("SUBSCRIPTION_DEV"));
    mocks.subscriber.mockResolvedValue(null);
    expect((await (await GET(request(), ctx)).json()).data).toMatchObject({
      setupRequired: true,
      subscriber: null,
      allowance: "0",
    });
    const response = await POST(request({ amount: "1", userAddress: customer.publicKey() }), ctx);
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/configure/);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(mocks.allowance).not.toHaveBeenCalled();
  });
  it("refuses a different wallet before preparation", async () => {
    expect(
      (await POST(request({ amount: "1", userAddress: originalSubscriber }), ctx)).status,
    ).toBe(403);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it.each(["subscriber", "asset", "cancelled"])(
    "refuses changed %s between preparation and submit",
    async (field) => {
      const prepared = await prepare();
      if (field === "subscriber") mocks.subscriber.mockResolvedValue(originalSubscriber);
      if (field === "asset") mocks.asset.mockResolvedValue(spender);
      if (field === "cancelled") mocks.cancelled.mockResolvedValue(true);
      const response = await submit(
        request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }),
        ctx,
      );
      expect([403, 422]).toContain(response.status);
      expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
      expect(mocks.record).not.toHaveBeenCalled();
    },
  );
  it("reads actual asset and avoids displaying a stale graph asset label", async () => {
    mocks.asset.mockResolvedValue(spender);
    const read = await GET(request(), ctx);
    expect((await read.json()).data).toMatchObject({
      asset: null,
      assetLabel: spender,
      tokenContractAddress: spender,
    });
    const prepared = await prepare();
    expect(
      (TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction).operations,
    ).toHaveLength(1);
    expect(mocks.allowance).toHaveBeenCalledWith(
      expect.objectContaining({ tokenContractAddress: spender }),
    );
  });
  it.each([
    "missing",
    "wrong-kind",
    "wrong-root",
    "ambiguous",
    "missing-node",
    "wrong-node",
    "wrong-network",
  ])("refuses %s deployment", async (bad) => {
    const d = deployment();
    if (bad === "wrong-kind") d.flow.templateKind = "SPLITTER";
    if (bad === "wrong-root") d.graphSnapshot.nodes[0] = { ...graph.nodes[0]!, type: "on_receive" };
    if (bad === "ambiguous")
      d.pipelineSnapshot.push({ ...d.pipelineSnapshot[0]!, templateKind: "SUBSCRIPTION_DEV" });
    if (bad === "missing-node") d.pipelineSnapshot = [];
    if (bad === "wrong-node") d.pipelineSnapshot[0]!.nodeId = "other";
    if (bad === "wrong-network") d.network = "mainnet";
    mocks.db.deployment.findFirst.mockResolvedValue(bad === "missing" ? null : d);
    const res = await POST(request({ amount: "200", userAddress: customer.publicKey() }), ctx);
    expect([404, 422]).toContain(res.status);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(mocks.db.deployment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, status: "CONFIRMED" } }),
    );
  });
  it("refuses invalid inputs and cumulative overflow before simulation", async () => {
    for (const amount of ["0", "x", "-1", "1.1"])
      expect((await POST(request({ amount, userAddress: customer.publicKey() }), ctx)).status).toBe(
        422,
      );
    mocks.allowance.mockResolvedValue(MAX_ALLOWANCE);
    expect(
      (await POST(request({ amount: "1", userAddress: customer.publicKey() }), ctx)).status,
    ).toBe(422);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("fails closed when contract state or simulation is unavailable", async () => {
    mocks.subscriber.mockRejectedValueOnce(new AppError("UPSTREAM_RPC", "State unavailable"));
    expect(
      (await POST(request({ amount: "1", userAddress: customer.publicKey() }), ctx)).status,
    ).toBe(502);
    mocks.rpc.simulateTransaction.mockResolvedValue({
      _parsed: true,
      error: "Simulation failed",
      events: [],
    });
    expect(
      (await POST(request({ amount: "1", userAddress: customer.publicKey() }), ctx)).status,
    ).toBe(502);
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects cross-deployment intents before reading or recording", async () => {
    const prepared = await prepare();
    vi.clearAllMocks();
    expect(
      (
        await submit(request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }), {
          params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
        })
      ).status,
    ).toBe(422);
    expect(mocks.db.deployment.findFirst).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("returns a confirmed replay without resending, even after the subscriber changes", async () => {
    const prepared = await prepare();
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    mocks.subscriber.mockResolvedValue(originalSubscriber);
    const response = await submit(
      request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }),
      ctx,
    );
    expect((await response.json()).data.status).toBe("SUCCESS");
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("returns an on-chain failure without resending or recording approval success", async () => {
    const prepared = await prepare();
    mocks.rpc.getTransaction.mockResolvedValue({ status: "FAILED" });
    const response = await submit(
      request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }),
      ctx,
    );
    expect((await response.json()).data.status).toBe("FAILED");
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("retains the exact hash for reconciliation after an uncertain send", async () => {
    const prepared = await prepare();
    mocks.rpc.sendTransaction.mockRejectedValueOnce(new Error("Lost RPC response"));
    const signedXdr = sign(prepared.xdr);
    expect((await submit(request({ signedXdr, intent: prepared.intent }), ctx)).status).toBe(502);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ txHash: prepared.txHash }) }),
    );
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    expect(
      (await (await submit(request({ signedXdr, intent: prepared.intent }), ctx)).json()).data
        .status,
    ).toBe("SUCCESS");
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledOnce();
  });
  it("does not send when the status read fails", async () => {
    const prepared = await prepare();
    mocks.rpc.getTransaction.mockRejectedValue(new Error("RPC unavailable"));
    expect(
      (await submit(request({ signedXdr: sign(prepared.xdr), intent: prepared.intent }), ctx))
        .status,
    ).toBe(502);
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
