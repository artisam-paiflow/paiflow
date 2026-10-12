import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { db } from "@/lib/db";
import { createControlIntent, reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
const expiry = Math.floor(Date.now() / 1000) + 180;
const wallet = Keypair.random();
const contract = StrKey.encodeContract(Buffer.alloc(32, 7));
let ownerId: string;
let flowId: string;
let tokenId: string;
let deployment: Deployment;
function tx(sequence = "10") {
  return new TransactionBuilder(new Account(wallet.publicKey(), sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call("unsubscribe"))
    .setTimebounds(0, expiry)
    .build();
}
function prepare(sequence = "10") {
  return createControlIntent({
    deployment,
    nodeId: "subscription",
    action: "subscription.cancel",
    walletAddress: wallet.publicKey(),
    unsignedXdr: tx(sequence).toXDR(),
    preparationLedger: 90,
  });
}
beforeAll(async () => {
  ownerId = (
    await db.user.create({ data: { username: `control-${randomUUID()}`, passwordHash: "unused" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "control foundation",
        templateKind: "SUBSCRIPTION",
        graph: {},
        parameters: {},
      },
    })
  ).id;
  deployment = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      graphSnapshot: {},
      paramsSnapshot: {},
      pipelineSnapshot: [
        { nodeId: "subscription", templateKind: "SUBSCRIPTION", contractAddress: contract },
      ],
    },
  });
  tokenId = (
    await db.deploymentApiToken.create({
      data: {
        deploymentId: deployment.id,
        createdById: ownerId,
        label: "control-test",
        tokenHash: randomUUID(),
        tokenPrefix: "pfk_test",
      },
    })
  ).id;
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockImplementation(async (transaction) => {
    // Prove the real durable admission hash exists BEFORE the mocked network send.
    const hash = transaction.hash().toString("hex");
    expect(
      await db.serviceTransaction.count({
        where: { txHash: hash, work: { deploymentId: deployment.id } },
      }),
    ).toBe(1);
    expect(
      await db.signedTransaction.count({ where: { txHash: hash, deploymentId: deployment.id } }),
    ).toBe(1);
    return { status: "PENDING" };
  });
});
afterAll(async () => {
  if (deployment) {
    await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: deployment.id } } });
    await db.deploymentWork.deleteMany({ where: { deploymentId: deployment.id } });
    await db.walletControlIntent.deleteMany({ where: { deploymentId: deployment.id } });
    await db.signedTransaction.deleteMany({ where: { deploymentId: deployment.id } });
    await db.auditLog.deleteMany({
      where: { metadata: { path: ["deploymentId"], equals: deployment.id } },
    });
    await db.deployment.delete({ where: { id: deployment.id } });
  }
  if (flowId) await db.flow.delete({ where: { id: flowId } });
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
});
describe("wallet-control reservations with real PostgreSQL", () => {
  it("serializes simultaneous preparation and simultaneous submit across durable rows", async () => {
    const preparations = await Promise.allSettled([prepare(), prepare("11"), prepare("12")]);
    const fulfilled = preparations.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(preparations.filter((result) => result.status === "rejected")).toHaveLength(2);
    const intent = await db.walletControlIntent.findFirstOrThrow({
      where: { deploymentId: deployment.id },
    });
    const chosenSequence = ["10", "11", "12"].find(
      (sequence) => tx(sequence).hash().toString("hex") === intent.txHash,
    )!;
    const signed = tx(chosenSequence);
    signed.sign(wallet);
    const submit = () =>
      submitControlIntent({
        deployment,
        tokenId,
        action: "subscription.cancel",
        intent: intent.id,
        signedXdr: signed.toXDR(),
        ip: "127.0.0.1",
        assertEligible: async () => undefined,
      });
    await Promise.all([submit(), submit(), submit()]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (await db.walletControlIntent.findUniqueOrThrow({ where: { id: intent.id } })).state,
    ).toBe("SUBMITTING");
    await expect(prepare("13")).rejects.toMatchObject({ code: "CONFLICT" });
    // Recovery must outlive the RPC's short history window.
    mocks.get.mockResolvedValue({ status: "FAILED", ledger: 100 });
    await reconcileControlIntent(intent.id, deployment.id, "subscription.cancel");
    // Simulate a crash after the intent was finalized but before admission bookkeeping.
    await db.serviceTransaction.updateMany({
      where: { txHash: intent.txHash },
      data: { state: "PENDING" },
    });
    mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
    expect(await getTransactionStatus(deployment, intent.txHash)).toMatchObject({
      status: "FAILED",
      ledger: 100,
    });
    expect(
      await db.serviceTransaction.count({ where: { txHash: intent.txHash, state: "PENDING" } }),
    ).toBe(0);
    const next = await prepare("14");
    expect(next.intent).not.toBe(intent.id);
  });
  it("retirement closes preparation while unresolved rows remain durable", async () => {
    await db.deployment.update({
      where: { id: deployment.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await expect(prepare("15")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, state: "PREPARED" },
      }),
    ).toBe(1);
  });
});
