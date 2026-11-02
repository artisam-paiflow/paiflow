import { Account, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instanceAdmin, instanceDefinition } from "@/tests/fixtures/instance-acceptance";

const mocks = vi.hoisted(() => ({
  signed: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  outcome: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    signedTransaction: { findFirst: mocks.signed },
    deployment: { updateMany: mocks.update },
  },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    getTransaction: mocks.get,
    sendTransaction: mocks.send,
  }),
}));
vi.mock("@/lib/deployments/confirm", () => ({ confirmDeployment: mocks.confirm }));
vi.mock("@/lib/analytics/outcomes", () => ({ recordTransactionOutcome: mocks.outcome }));
import { reconcileOwnerDeployment } from "@/lib/deployments/reconcile-owner-deployment";

const tx = new TransactionBuilder(new Account(instanceAdmin, "1"), {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.manageData({ name: "recovery-test", value: "unsigned" }))
  .setTimeout(180)
  .build();
const hash = tx.hash().toString("hex");
function deployment() {
  // Only the fields read by owner reconciliation are needed for this retained
  // admission fixture. No transaction preparation or submission is exercised.
  return {
    id: "existing-multisig",
    ownerId: "owner",
    serviceState: "ACTIVE",
    status: "SUBMITTED",
    templateVersionId: null,
    network: "testnet",
    deployTxHash: hash,
    unsignedXdr: tx.toXDR(),
    sourceAccount: instanceAdmin,
    graphSnapshot: instanceDefinition("multisig").graph,
    paramsSnapshot: [{ templateKind: "DEPOSIT_TRIGGER" }, { templateKind: "MULTISIG" }],
  } as unknown as Parameters<typeof reconcileOwnerDeployment>[0];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signed.mockResolvedValue({ txHash: hash });
  mocks.update.mockResolvedValue({ count: 1 });
});
describe("retained Multisig owner reconciliation", () => {
  it.each(["NOT_FOUND", "PENDING"])(
    "keeps %s unresolved without sending or rewriting admission",
    async (status) => {
      const original = deployment();
      const evidence = structuredClone(original);
      mocks.get.mockResolvedValue({ status });
      await reconcileOwnerDeployment(original);
      expect(mocks.get).toHaveBeenCalledWith(hash);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.outcome).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(original).toEqual(evidence);
    },
  );
  it("still records actual ledger failure for the original submitted hash", async () => {
    mocks.get.mockResolvedValue({ status: "FAILED", ledger: 123 });
    await reconcileOwnerDeployment(deployment());
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "existing-multisig", ownerId: "owner", status: "SUBMITTED", deployTxHash: hash },
      data: { status: "FAILED", errorMessage: "Transaction failed on the network" },
    });
    expect(mocks.outcome).toHaveBeenCalledWith(hash, "FAILED", {
      deploymentId: "existing-multisig",
      ledger: 123,
      failureCode: "ONCHAIN_FAILED",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
