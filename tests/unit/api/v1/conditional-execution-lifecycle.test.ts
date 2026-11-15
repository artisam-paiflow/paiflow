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
import type { Deployment, PrismaClient } from "@prisma/client";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
import { ConditionalExecutionIntentSchema } from "@/lib/flows/conditional-v2";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptanceIntent,
  conditionalAcceptancePlan,
} from "@/tests/fixtures/conditional-v2-acceptance";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  get: vi.fn(),
  client: null as unknown as PrismaClient,
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(mocks.client, key);
        return typeof value === "function" ? value.bind(mocks.client) : value;
      },
    },
  ),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { db } from "@/lib/db";
import {
  createConditionalExecutionIntent as createExecutionIntent,
  findConditionalExecutionRetry as findExecutionRetry,
} from "@/lib/api/v1/conditional-execution-intent";
import {
  executionIdempotencyKey,
  findExecutionRetry as findV1Retry,
} from "@/lib/api/v1/execution-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
const payer = Keypair.random();
const definition = conditionalAcceptanceDefinition("amount_gt", "pay", "pay");
const plan = conditionalAcceptancePlan(definition);
const root = plan.bindings[0]!.contractAddress;
let ownerId: string;
let flowId: string;
let tokenId: string;
let deployment: Deployment;
const expiry = Math.floor(Date.now() / 1000) + 180;
const scratch = scratchDatabase();
function prepare(
  nonce: string,
  wallet = payer.publicKey(),
  key = "order:1",
  digest = "ab".repeat(32),
) {
  const execution = ConditionalExecutionIntentSchema.parse({
    ...conditionalAcceptanceIntent(definition, "111"),
    deploymentId: deployment.id,
    payer: wallet,
    nonce: nonce.repeat(64),
    expiresAtLedger: 200,
  });
  const tx = new TransactionBuilder(new Account(wallet, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(root).call("execute_v2", ...executionV2Args(execution)))
    .setTimebounds(0, expiry)
    .build();
  return createExecutionIntent({
    deployment,
    execution,
    artifacts: execution.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      wasmHash: node.wasmHash,
    })),
    unsignedXdr: tx.toXDR(),
    preparationLedger: 100,
    keyHash: executionIdempotencyKey(key),
    requestDigest: digest,
  });
}
beforeAll(async () => {
  mocks.client = await scratch.start();
  ownerId = (
    await db.user.create({
      data: { username: `execution-${randomUUID()}`, passwordHash: "unused" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "conditional execution intent concurrency",
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
      pipelineSnapshot: plan.nodes.map((node) => ({
        nodeId: node.nodeId,
        templateKind: node.templateKind,
        contractAddress: node.initialState.contractAddress,
      })),
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
  await scratch.stop();
});
describe("conditional execution financial admission with real PostgreSQL", () => {
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
  it("durably refused keys cannot later admit conditional payments", async () => {
    const key = "refused-conditional",
      digest = "dc".repeat(32);
    await db.mutationPreparationRefusal.create({
      data: {
        deploymentId: deployment.id,
        network: "testnet",
        idempotencyKeyHash: executionIdempotencyKey(key)!,
        requestDigest: digest,
        admin: payer.publicKey(),
        request: {
          admin: payer.publicKey(),
          arguments: {
            version: 1,
            changes: [
              {
                kind: "pay",
                nodeId: "retained",
                expectedRevision: "0",
                recipient: payer.publicKey(),
              },
            ],
          },
        },
        reasonCode: "VALIDATION",
      },
    });
    await expect(prepare("9", Keypair.random().publicKey(), key, digest)).rejects.toMatchObject({
      code: "VALIDATION",
      fields: { preparationRefusal: [expect.any(String)] },
    });
    expect(
      await db.walletControlIntent.count({
        where: { deploymentId: deployment.id, idempotencyKeyHash: executionIdempotencyKey(key) },
      }),
    ).toBe(0);
  });
  it("does not expose a v2 keyed receipt through the v1 operation", async () => {
    const original = await findExecutionRetry(
      deployment.id,
      executionIdempotencyKey("order:1"),
      "ab".repeat(32),
    );
    await expect(
      findV1Retry(deployment.id, executionIdempotencyKey("order:1"), "ab".repeat(32)),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fields: { intent: [original!.intent], txHash: [original!.txHash] },
    });
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
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
