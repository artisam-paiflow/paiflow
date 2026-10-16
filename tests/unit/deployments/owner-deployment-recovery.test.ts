import {
  Account,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  deployment: { findFirst: vi.fn(), updateMany: vi.fn() },
  signedTransaction: { findFirst: vi.fn() },
  getTransaction: vi.fn(),
  confirm: vi.fn(),
  outcome: vi.fn(),
  session: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { deployment: m.deployment, signedTransaction: m.signedTransaction },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getTransaction: m.getTransaction }),
}));
vi.mock("@/lib/deployments/confirm", () => ({ confirmDeployment: m.confirm }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: m.outcome }));
vi.mock("@/lib/auth", () => ({ requireSession: m.session }));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: m.limit }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
import { reconcileOwnerDeployment } from "@/lib/deployments/reconcile-owner-deployment";
import { GET } from "@/app/api/deployments/[id]/status/route";
type Deployment = Parameters<typeof reconcileOwnerDeployment>[0];
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const source = Keypair.random();
const contract = StrKey.encodeContract(Buffer.alloc(32, 17));
const address = StrKey.encodeContract(Buffer.alloc(32, 18));
function fixture() {
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call("deploy_pipeline"))
    .setTimeout(180)
    .build();
  return {
    id,
    ownerId: owner,
    network: "testnet",
    serviceState: "ACTIVE",
    status: "SUBMITTED",
    unsignedXdr: tx.toXDR(),
    sourceAccount: source.publicKey(),
    deployTxHash: tx.hash().toString("hex"),
    graphSnapshot: {
      nodes: [
        { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "pay",
          type: "pay",
          config: { asset: { kind: "native" }, recipient: source.publicKey(), fullAmount: true },
        },
      ],
      edges: [{ id: "e", source: "receive", target: "pay" }],
    },
    paramsSnapshot: [{ nodeId: "pay", templateKind: "PAYER", params: {} }],
    pipelineSnapshot: [{ nodeId: "pay", templateKind: "PAYER", contractAddress: address }],
    flow: { templateKind: "SUBSCRIPTION" },
  } as unknown as Deployment;
}
function success() {
  return {
    status: "SUCCESS",
    ledger: 123,
    returnValue: xdr.ScVal.scvVec([new Address(address).toScVal()]),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.STELLAR_NETWORK = "testnet";
  m.signedTransaction.findFirst.mockResolvedValue({ txHash: fixture().deployTxHash });
  m.getTransaction.mockResolvedValue(success());
  m.deployment.updateMany.mockResolvedValue({ count: 1 });
  m.session.mockResolvedValue({ id: owner });
});
afterEach(() => {
  vi.useRealTimers();
});
it("finalizes only the immutable submitted hash and historical kind after authoritative success", async () => {
  const d = fixture();
  await reconcileOwnerDeployment(d);
  expect(m.getTransaction).toHaveBeenCalledExactlyOnceWith(d.deployTxHash);
  expect(m.signedTransaction.findFirst).toHaveBeenCalledWith({
    where: {
      txHash: d.deployTxHash,
      deploymentId: id,
      userId: owner,
      kind: "DEPLOY",
      network: "testnet",
      signerAddress: source.publicKey(),
    },
    select: { txHash: true },
  });
  expect(m.confirm).toHaveBeenCalledWith(
    { ...d, flow: { templateKind: "PAYER" } },
    { txHash: d.deployTxHash, contractAddress: address },
    source.publicKey(),
    true,
  );
  expect(m.outcome).toHaveBeenCalledWith(d.deployTxHash, "CONFIRMED", {
    deploymentId: id,
    ledger: 123,
  });
});
it.each(["NOT_FOUND", "PENDING"])("holds %s without bookkeeping or a dispatch", async (status) => {
  m.getTransaction.mockResolvedValue({ status });
  await reconcileOwnerDeployment(fixture());
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.outcome).not.toHaveBeenCalled();
  expect(m.deployment.updateMany).not.toHaveBeenCalled();
});
it("keeps a timeout unresolved even if the read later resolves SUCCESS", async () => {
  vi.useFakeTimers();
  let resolve!: (v: ReturnType<typeof success>) => void;
  m.getTransaction.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = reconcileOwnerDeployment(fixture());
  await vi.advanceTimersByTimeAsync(3001);
  await pending;
  resolve(success());
  await Promise.resolve();
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.outcome).not.toHaveBeenCalled();
});
it("holds RPC exceptions instead of falsely failing or retrying", async () => {
  m.getTransaction.mockRejectedValue(new Error("RPC timeout"));
  await reconcileOwnerDeployment(fixture());
  expect(m.getTransaction).toHaveBeenCalledOnce();
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.deployment.updateMany).not.toHaveBeenCalled();
});
it.each(["hash", "source", "missing", "malformed", "signed", "network", "retired"])(
  "fails closed for invalid %s prepared binding before RPC",
  async (change) => {
    const d = fixture();
    if (change === "hash") d.deployTxHash = "f".repeat(64);
    if (change === "source") d.sourceAccount = Keypair.random().publicKey();
    if (change === "missing") d.unsignedXdr = null;
    if (change === "malformed") d.unsignedXdr = "invalid";
    if (change === "signed") {
      const tx = TransactionBuilder.fromXDR(d.unsignedXdr!, Networks.TESTNET);
      tx.sign(source);
      d.unsignedXdr = tx.toXDR();
    }
    if (change === "network") d.network = "mainnet";
    if (change === "retired") d.serviceState = "RETIRED";
    await reconcileOwnerDeployment(d);
    expect(m.getTransaction).not.toHaveBeenCalled();
    expect(m.confirm).not.toHaveBeenCalled();
  },
);
it("missing or mismatched kind/network/deployment/signer row cannot authorize recovery", async () => {
  m.signedTransaction.findFirst.mockResolvedValue(null);
  await reconcileOwnerDeployment(fixture());
  expect(m.getTransaction).not.toHaveBeenCalled();
  expect(m.confirm).not.toHaveBeenCalled();
});
it.each(["missing", "different", "malformed"])(
  "refuses %s factory return addresses",
  async (kind) => {
    m.getTransaction.mockResolvedValue({
      ...success(),
      returnValue:
        kind === "missing"
          ? undefined
          : kind === "malformed"
            ? xdr.ScVal.scvBool(true)
            : xdr.ScVal.scvVec([new Address(contract).toScVal()]),
    });
    await reconcileOwnerDeployment(fixture());
    expect(m.confirm).not.toHaveBeenCalled();
    expect(m.outcome).not.toHaveBeenCalled();
  },
);
it("records a proven failure only with an exact submitted-hash compare-and-set", async () => {
  const d = fixture();
  m.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 124 });
  await reconcileOwnerDeployment(d);
  expect(m.deployment.updateMany).toHaveBeenCalledWith({
    where: { id, ownerId: owner, status: "SUBMITTED", deployTxHash: d.deployTxHash },
    data: { status: "FAILED", errorMessage: "Transaction failed on the network" },
  });
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.outcome).toHaveBeenCalledWith(d.deployTxHash, "FAILED", {
    deploymentId: id,
    ledger: 124,
    failureCode: "ONCHAIN_FAILED",
  });
});
it("owner status refuses another owner's row before reading any chain hash", async () => {
  m.deployment.findFirst.mockResolvedValue(null);
  const response = await GET(
    new Request("https://example.test/api/deployments/" + id + "/status") as NextRequest,
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(404);
  expect(m.deployment.findFirst).toHaveBeenCalledWith({
    where: { id, ownerId: owner },
    include: { flow: { select: { templateKind: true } } },
  });
  expect(m.getTransaction).not.toHaveBeenCalled();
});
it("owner status exposes matching stored hash after success without requiring caller-supplied hash", async () => {
  const d = fixture();
  m.deployment.findFirst
    .mockResolvedValueOnce(d)
    .mockResolvedValueOnce({ status: "CONFIRMED", deployTxHash: d.deployTxHash });
  const response = await GET(
    new Request(
      "https://example.test/api/deployments/" + id + "/status?txHash=untrusted",
    ) as NextRequest,
    { params: Promise.resolve({ id }) },
  );
  expect(await response.json()).toEqual({ status: "CONFIRMED", txHash: d.deployTxHash });
  expect(m.getTransaction).toHaveBeenCalledWith(d.deployTxHash);
});
it.each(["graph", "params", "pipeline", "identity", "trigger-kind"])(
  "refuses malformed or inconsistent immutable %s metadata",
  async (kind) => {
    const d = fixture();
    if (kind === "graph") d.graphSnapshot = {};
    if (kind === "params") d.paramsSnapshot = [];
    if (kind === "pipeline") d.pipelineSnapshot = null;
    if (kind === "identity") d.paramsSnapshot = [{ nodeId: "unrelated", templateKind: "PAYER" }];
    if (kind === "trigger-kind")
      d.paramsSnapshot = [{ nodeId: "pay", templateKind: "SUBSCRIPTION" }];
    await reconcileOwnerDeployment(d);
    expect(m.confirm).not.toHaveBeenCalled();
    expect(m.outcome).not.toHaveBeenCalled();
  },
);
it("already confirmed status is idempotent and does not make a new RPC read", async () => {
  const d = fixture();
  d.status = "CONFIRMED";
  await reconcileOwnerDeployment(d);
  expect(m.getTransaction).not.toHaveBeenCalled();
  expect(m.confirm).not.toHaveBeenCalled();
});
it("a status poll retains SUBMITTED and its hash after an RPC timeout", async () => {
  const d = fixture();
  m.getTransaction.mockRejectedValue(new Error("RPC timeout"));
  m.deployment.findFirst
    .mockResolvedValueOnce(d)
    .mockResolvedValueOnce({ status: "SUBMITTED", deployTxHash: d.deployTxHash });
  const r = await GET(
    new Request("https://example.test/api/deployments/" + id + "/status") as NextRequest,
    { params: Promise.resolve({ id }) },
  );
  expect(await r.json()).toEqual({ status: "SUBMITTED", txHash: d.deployTxHash });
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.outcome).not.toHaveBeenCalled();
});
