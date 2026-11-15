import { Address, xdr } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  signed: vi.fn(),
  find: vi.fn(),
  get: vi.fn(),
  latest: vi.fn(),
  ledgers: vi.fn(),
  factory: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    signedTransaction: { findUnique: m.signed, findFirst: m.signed },
    deployment: { findUnique: m.find },
  },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getTransaction: m.get, getLatestLedger: m.latest, getLedgers: m.ledgers }),
}));
vi.mock("@/lib/stellar/config", () => ({ getFactoryAddress: m.factory }));
vi.mock("@/lib/deployments/confirm", () => ({ confirmDeployment: m.confirm }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: vi.fn() }));
import { preparedDeploymentRecovery } from "@/lib/stellar/deployment-recovery";
import { reconcileOwnerDeployment } from "@/lib/deployments/reconcile-owner-deployment";
import { recoveredDeploymentReferences } from "@/lib/deployments/deployment-recovery";
import { conditionalPreparedFixture } from "@/tests/fixtures/conditional-deploy";
function original(f = conditionalPreparedFixture()) {
  return {
    id: f.deploymentId,
    ownerId: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date(),
    network: "testnet",
    status: "PENDING_SIGNATURE",
    serviceState: "ACTIVE",
    templateVersionId: null,
    preparedTxHash: f.txHash,
    unsignedXdr: f.xdr,
    sourceAccount: f.owner,
    deployTxHash: null,
    graphSnapshot: f.graph,
    paramsSnapshot: f.envelope,
    pipelineSnapshot: f.pipeline,
    flow: { templateKind: "ROUTER" },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.signed.mockResolvedValue(null);
  m.factory.mockResolvedValue(conditionalPreparedFixture().factory);
});
it("resumes only exact original with trusted currentfactory and complete immutable review evidence", async () => {
  const d = original();
  const originalHash = d.preparedTxHash;
  expect(await preparedDeploymentRecovery(d)).toMatchObject({
    status: "RESUMABLE",
    txHash: d.preparedTxHash,
  });
  m.factory.mockResolvedValue(Address.contract(Buffer.alloc(32, 67)).toString());
  expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
  expect(d.preparedTxHash).toBe(originalHash);
});
it.each(["hash", "salt", "missingEnvelope", "missingCanvas"])(
  "blocks recovery when retained %s is inconsistent",
  async (field) => {
    const d = original();
    if (field === "hash") d.preparedTxHash = "a".repeat(64);
    if (field === "salt") d.pipelineSnapshot[0]!.salt = "00".repeat(32);
    if (field === "missingEnvelope") Object.assign(d, { paramsSnapshot: [] });
    if (field === "missingCanvas") Object.assign(d, { graphSnapshot: { nodes: [], edges: [] } });
    expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
  },
);
it("keeps ambiguous prior signing blocked", async () => {
  const d = original();
  m.signed.mockResolvedValue({
    deploymentId: d.id,
    network: d.network,
    acceptedAt: new Date(),
    outcome: "ACCEPTED",
    submissionRevision: 1,
  });
  expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
});
it("requires ordered fullfactory result, including inactivebranch, with no metadata repair", () => {
  const d = original() as unknown as Parameters<typeof recoveredDeploymentReferences>[0];
  const success = {
    returnValue: xdr.ScVal.scvVec(
      original().pipelineSnapshot.map((node) => new Address(node.contractAddress).toScVal()),
    ),
  } as Parameters<typeof recoveredDeploymentReferences>[1];
  expect(recoveredDeploymentReferences(d, success)).toEqual({
    contractAddress: original().pipelineSnapshot[0]!.contractAddress,
  });
  const wrong = {
    returnValue: xdr.ScVal.scvVec(
      original()
        .pipelineSnapshot.slice(0, -1)
        .map((node) => new Address(node.contractAddress).toScVal()),
    ),
  } as Parameters<typeof recoveredDeploymentReferences>[1];
  expect(() => recoveredDeploymentReferences(d, wrong)).toThrow();
});
it("postclaim reconciliation keeps originalfactory and exacthash despite registry rotation", async () => {
  const f = conditionalPreparedFixture();
  const d = {
    ...original(f),
    status: "SUBMITTED",
    deployTxHash: f.txHash,
  } as unknown as Parameters<typeof reconcileOwnerDeployment>[0];
  m.factory.mockRejectedValue(new Error("registry unavailable"));
  m.signed.mockResolvedValue({ txHash: f.txHash });
  m.get.mockResolvedValue({
    status: "SUCCESS",
    ledger: 101,
    returnValue: xdr.ScVal.scvVec(
      f.pipeline.map((node) => new Address(node.contractAddress).toScVal()),
    ),
  });
  await reconcileOwnerDeployment(d);
  expect(m.get).toHaveBeenCalledWith(f.txHash);
  expect(m.confirm).toHaveBeenCalledOnce();
  expect(m.factory).not.toHaveBeenCalled();
});
it("never grants ordinaryconditional externalbroadcast exception without original signer admission", async () => {
  const f = conditionalPreparedFixture();
  const d = {
    ...original(f),
    status: "SUBMITTED",
    deployTxHash: f.txHash,
  } as unknown as Parameters<typeof reconcileOwnerDeployment>[0];
  await reconcileOwnerDeployment(d);
  expect(m.get).not.toHaveBeenCalled();
  expect(m.confirm).not.toHaveBeenCalled();
});
it("authoritative expiry remains available across factory registry rotation", async () => {
  const { TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
  const d = original();
  const maxTime = Math.floor(Date.now() / 1000) - 100;
  const tx = TransactionBuilder.cloneFrom(conditionalPreparedFixture().tx, {
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .setSorobanData(conditionalPreparedFixture().tx.toEnvelope().v1().tx().ext().sorobanData())
    .build();
  d.unsignedXdr = tx.toXDR();
  d.preparedTxHash = tx.hash().toString("hex");
  d.createdAt = new Date((maxTime - 100) * 1000);
  m.factory.mockRejectedValue(new Error("registry unavailable"));
  m.get.mockResolvedValue({
    status: "NOT_FOUND",
    oldestLedger: 1,
    oldestLedgerCloseTime: String(maxTime - 200),
    latestLedger: 200,
  });
  m.latest.mockResolvedValue({ sequence: 200 });
  m.ledgers.mockResolvedValue({
    ledgers: [{ sequence: 200, ledgerCloseTime: String(maxTime + 1) }],
  });
  m.find.mockResolvedValue(d);
  expect(await preparedDeploymentRecovery(d)).toMatchObject({
    status: "EXPIRED",
    txHash: d.preparedTxHash,
  });
  expect(m.factory).not.toHaveBeenCalled();
});
