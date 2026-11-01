import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { ExecutionIntentSchema } from "@/lib/flows/field-policies";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { db } from "@/lib/db";
import {
  createExecutionIntent,
  executionIdempotencyKey,
  findExecutionRetry,
} from "@/lib/api/v1/execution-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
const payer = Keypair.random();
const root = StrKey.encodeContract(Buffer.alloc(32, 21));
const pay = StrKey.encodeContract(Buffer.alloc(32, 22));
let ownerId: string;
let flowId: string;
let tokenId: string;
let deployment: Deployment;
const expiry = Math.floor(Date.now() / 1000) + 180;
function prepare(
  nonce: string,
  wallet = payer.publicKey(),
  key = "order:1",
  digest = "ab".repeat(32),
) {
  const execution = ExecutionIntentSchema.parse({
    version: 1,
    deploymentId: deployment.id,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: root,
    assetContract: Asset.native().contractId(Networks.TESTNET),
    payer: wallet,
    amountStroops: "100",
    nonce: nonce.repeat(64),
    expiresAtLedger: 200,
    nodes: [
      { nodeId: "root", contractAddress: root, expectedRevision: "0" },
      { nodeId: "pay", contractAddress: pay, expectedRevision: "0" },
    ],
    arguments: { version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: wallet }] },
  });
  const tx = new TransactionBuilder(new Account(wallet, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(root).call("execute_v1", ...executionV1Args(execution)))
    .setTimebounds(0, expiry)
    .build();
  return createExecutionIntent({
    deployment,
    execution,
    artifacts: execution.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      wasmHash:
        index === 0 ? EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER : EXECUTION_V1_WASM_HASHES.PAYER,
    })),
    unsignedXdr: tx.toXDR(),
    preparationLedger: 100,
    keyHash: executionIdempotencyKey(key),
    requestDigest: digest,
  });
}
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `execution-${randomUUID()}`, passwordHash: "unused" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "execution intent concurrency",
        templateKind: "PAYER",
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
        { nodeId: "root", templateKind: "DEPOSIT_TRIGGER", contractAddress: root },
        { nodeId: "pay", templateKind: "PAYER", contractAddress: pay },
      ],
    },
  });
  tokenId = (
    await db.deploymentApiToken.create({
      data: {
        deploymentId: deployment.id,
        createdById: ownerId,
        tokenHash: randomUUID(),
        tokenPrefix: "pfk_test",
      },
    })
  ).id;
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockImplementation(async (transaction: Transaction) => {
    const txHash = transaction.hash().toString("hex");
    // These writes must exist durably before the mocked external send.
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, txHash, state: "SUBMITTING" },
      }),
    ).toBe(1);
    expect(
      await db.signedTransaction.count({ where: { deploymentId: deployment.id, txHash } }),
    ).toBe(1);
    expect(
      await db.serviceTransaction.count({
        where: { txHash, work: { deploymentId: deployment.id } },
      }),
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
describe("execution financial admission with real PostgreSQL", () => {
  it("serializes same-key preparations and changed-payload conflicts across replicas", async () => {
    const results = await Promise.all([prepare("1"), prepare("2"), prepare("3")]);
    expect(new Set(results.map((result) => result.intent)).size).toBe(1);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
    expect(
      await findExecutionRetry(deployment.id, executionIdempotencyKey("order:1"), "ab".repeat(32)),
    ).toEqual(results[0]);
    await expect(prepare("4", payer.publicKey(), "order:1", "cd".repeat(32))).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
  });
  it("claims one send, retains unknown reservation and recovers durable finality", async () => {
    const prepared = await prepare("1");
    const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction;
    tx.sign(payer);
    const submit = () =>
      submitControlIntent({
        deployment,
        tokenId,
        action: "payment.execute",
        intent: prepared.intent!,
        signedXdr: tx.toXDR(),
        ip: "127.0.0.1",
        assertEligible: async () => undefined,
      });
    await Promise.all([submit(), submit(), submit()]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await expect(prepare("5", payer.publicKey(), "order:2")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await prepare("6", Keypair.random().publicKey(), "another-payer");
    mocks.get.mockResolvedValue({ status: "FAILED", ledger: 150 });
    await reconcileControlIntent(prepared.intent!, deployment.id, "payment.execute");
    await db.serviceTransaction.updateMany({
      where: { txHash: prepared.txHash },
      data: { state: "PENDING" },
    });
    mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
    expect(await getTransactionStatus(deployment, prepared.txHash!)).toMatchObject({
      status: "FAILED",
      ledger: 150,
    });
    expect(
      await db.serviceTransaction.count({ where: { txHash: prepared.txHash, state: "PENDING" } }),
    ).toBe(0);
    await prepare("7", payer.publicKey(), "order:2");
  });
  it("retirement blocks new preparation while retaining outstanding financial receipts", async () => {
    await db.deployment.update({
      where: { id: deployment.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await expect(prepare("8", Keypair.random().publicKey(), "retired")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, state: "PREPARED" },
      }),
    ).toBe(2);
  });
});
