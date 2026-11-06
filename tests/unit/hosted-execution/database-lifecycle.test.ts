import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import type { ExecutionIntent } from "@/lib/flows/field-policies";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  observation: vi.fn(),
  refresh: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/stellar/execution-state", () => ({
  readExecutionState: mocks.read,
  readExecutionStateForReview: mocks.observation,
}));
vi.mock("@/lib/stellar/prepare-execution", () => ({ prepareExecutionTransaction: mocks.prepare }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/stellar/allowance-status", () => ({ allowanceHasExpired: async () => false }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import {
  prepareHostedPayment,
  readHostedReceipt,
  reconcileHostedPayment,
  setHostedVisibility,
  submitHostedPayment,
} from "@/lib/hosted-execution/service";
import { hostedState, payment } from "./fixtures";
import { createHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership";
function ownership(deploymentId: string, recoveryKey = key) {
  const challenge = createHostedOwnershipChallenge(deploymentId, { recoveryKey, payment });
  const tx = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET) as Transaction;
  tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
  return tx.toXDR();
}

let ownerId: string;
let flowId: string;
const ids: string[] = [];
const key = "ab".repeat(32);
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `hosted-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId,
        name: "hosted fixture",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockImplementation(async (deployment: { id: string }) => ({
    ...hostedState,
    deploymentId: deployment.id,
  }));
  mocks.observation.mockImplementation(async (deployment: { id: string }) => ({
    current: await mocks.read(deployment),
    refresh: () => mocks.refresh(deployment),
  }));
  mocks.refresh.mockImplementation(async (deployment: { id: string }) => {
    // Model the request-local post-admission fence, not another full discovery.
    // A fresh review must only run after its original durable admission commits.
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
    return { ...hostedState, deploymentId: deployment.id };
  });
  mocks.prepare.mockImplementation(async (execution: ExecutionIntent) => ({
    xdr: new TransactionBuilder(new Account(execution.payer, "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(execution.rootContract).call("execute_v1", ...executionV1Args(execution)),
      )
      .setTimeout(180)
      .build()
      .toXDR(),
  }));
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
});
afterAll(async () => {
  await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: { in: ids } } } });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.walletControlIntent.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { userId: ownerId } });
  await db.deployment.deleteMany({ where: { id: { in: ids } } });
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: ownerId } });
});
async function deployment(enabled?: boolean) {
  const created = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      graphSnapshot: { fieldPolicies: { version: 1, nodes: [] } },
      paramsSnapshot: {},
      pipelineSnapshot: hostedState.nodes.map((node) => ({
        nodeId: node.nodeId,
        contractAddress: node.contractAddress,
        templateKind: node.nodeId === "root" ? "DEPOSIT_TRIGGER" : "PAYER",
        wasmHash: node.capabilities.wasmHash,
      })) as Prisma.InputJsonValue,
      ...(enabled === undefined ? {} : { hostedExecutionEnabled: enabled }),
    },
  });
  ids.push(created.id);
  return created;
}
describe("hosted durable database boundary", () => {
  it.each(["optout", "RETIRING"] as const)(
    "persists receipt capability atomically and recovers a postcommit crash after %s",
    async (closed) => {
      const d = await deployment(true);
      const refresh = mocks.refresh.getMockImplementation()!;
      mocks.refresh.mockImplementationOnce(async (deployment: { id: string }) => {
        await refresh(deployment);
        throw new Error("response crashed after financial commit");
      });
      await expect(
        prepareHostedPayment(d, { recoveryKey: key, payment, ownershipProofXdr: ownership(d.id) }),
      ).rejects.toThrow("response crashed after financial commit");
      const row = await db.walletControlIntent.findFirstOrThrow({ where: { deploymentId: d.id } });
      expect(row.hostedAccessHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.state).toBe("PREPARED");
      // The admitted original is recoverable while enabled without a new proof,
      // simulation or request-local witness. Its review uses fresh discovery.
      const retried = await prepareHostedPayment(d, { recoveryKey: key, payment });
      expect(retried.prepared).toMatchObject({ intent: row.id, txHash: row.txHash });
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.observation).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      const closedDeployment = await db.deployment.update({
        where: { id: d.id },
        data:
          closed === "optout"
            ? { hostedExecutionEnabled: false }
            : { serviceState: closed, retirementRequestedAt: new Date() },
      });
      expect((await readHostedReceipt(d.id, key)).id).toBe(row.id);
      expect((await reconcileHostedPayment(closedDeployment, key)).intent).toBe(row.id);
      await expect(
        prepareHostedPayment(closedDeployment, { recoveryKey: key, payment }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await db.walletControlIntent.count({ where: { deploymentId: d.id, state: "PREPARED" } }),
      ).toBe(1);
    },
  );
  it.each(["optout", "RETIRING"] as const)(
    "recovers retained null-marker crash history after %s using only its scoped namespaced capability",
    async (closed) => {
      const d = await deployment(true);
      const first = await prepareHostedPayment(d, {
        recoveryKey: key,
        payment,
        ownershipProofXdr: ownership(d.id),
      });
      await db.walletControlIntent.update({
        where: { id: first.prepared.intent },
        data: { hostedAccessHash: null },
      });
      const closedDeployment = await db.deployment.update({
        where: { id: d.id },
        data:
          closed === "optout"
            ? { hostedExecutionEnabled: false }
            : { serviceState: closed, retirementRequestedAt: new Date() },
      });
      expect((await readHostedReceipt(d.id, key)).id).toBe(first.prepared.intent);
      expect((await reconcileHostedPayment(closedDeployment, key)).intent).toBe(
        first.prepared.intent,
      );
      await expect(readHostedReceipt(d.id, "cd".repeat(32))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        prepareHostedPayment(closedDeployment, { recoveryKey: key, payment }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await db.walletControlIntent.count({ where: { deploymentId: d.id, state: "PREPARED" } }),
      ).toBe(1);
    },
  );
  it("keeps an in-flight proof-authorized preparation despite a concurrent retry observing no row yet", async () => {
    const d = await deployment(true);
    const prepareOriginal = mocks.prepare.getMockImplementation()!;
    let continuePreparation: () => void = () => {};
    let started = false;
    mocks.prepare.mockImplementationOnce(async (execution: ExecutionIntent) => {
      started = true;
      await new Promise<void>((resolve) => {
        continuePreparation = resolve;
      });
      return prepareOriginal(execution);
    });
    const original = prepareHostedPayment(d, {
      recoveryKey: key,
      payment,
      ownershipProofXdr: ownership(d.id),
    });
    await vi.waitFor(() => expect(started).toBe(true));
    try {
      expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(0);
      await expect(prepareHostedPayment(d, { recoveryKey: key, payment })).rejects.toMatchObject({
        code: "VALIDATION",
        fields: { ownershipProofXdr: [expect.any(String)] },
      });
    } finally {
      continuePreparation();
    }
    const result = await original;
    expect((await readHostedReceipt(d.id, key)).id).toBe(result.prepared.intent);
    expect(
      await db.walletControlIntent.count({ where: { deploymentId: d.id, state: "PREPARED" } }),
    ).toBe(1);
  });
  it("cannot reserve a victim payer without proof; invalid/mismatched proof creates no reservation", async () => {
    const d = await deployment(true);
    await expect(prepareHostedPayment(d, { recoveryKey: key, payment })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      prepareHostedPayment(d, {
        recoveryKey: "cd".repeat(32),
        payment,
        ownershipProofXdr: ownership(d.id),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(0);
    expect(mocks.prepare).not.toHaveBeenCalled();
    await prepareHostedPayment(d, {
      recoveryKey: key,
      payment,
      ownershipProofXdr: ownership(d.id),
    });
    const original = await readHostedReceipt(d.id, key);
    await expect(
      prepareHostedPayment(d, { recoveryKey: "cd".repeat(32), payment }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(1);
    expect((await readHostedReceipt(d.id, key)).id).toBe(original.id);
  });
  it("recovers after a crash before capability marking without another proof", async () => {
    const d = await deployment(true);
    const first = await prepareHostedPayment(d, {
      recoveryKey: key,
      payment,
      ownershipProofXdr: ownership(d.id),
    });
    await db.walletControlIntent.update({
      where: { id: first.prepared.intent },
      data: { hostedAccessHash: null },
    });
    expect((await prepareHostedPayment(d, { recoveryKey: key, payment })).prepared.intent).toBe(
      first.prepared.intent,
    );
    expect((await readHostedReceipt(d.id, key)).id).toBe(first.prepared.intent);
  });
  it("migration defaults existing/new visibility off, and audited owner opt-in persists atomically", async () => {
    const d = await deployment();
    expect(d.hostedExecutionEnabled).toBe(false);
    await setHostedVisibility(d, ownerId, true, "test-ip");
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).hostedExecutionEnabled,
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: {
          action: "HOSTED_EXECUTION_VISIBILITY",
          userId: ownerId,
          metadata: { path: ["deploymentId"], equals: d.id },
        },
      }),
    ).toBe(1);
  });
  it("concurrent/lost-ack prepares return one durable intent with hashed scoped recovery", async () => {
    const d = await deployment(true);
    const results = await Promise.all([
      prepareHostedPayment(d, { recoveryKey: key, payment, ownershipProofXdr: ownership(d.id) }),
      prepareHostedPayment(d, { recoveryKey: key, payment, ownershipProofXdr: ownership(d.id) }),
    ]);
    expect(results[0]!.prepared.intent).toBe(results[1]!.prepared.intent);
    expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(1);
    const row = await readHostedReceipt(d.id, key);
    expect(row.hostedAccessHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.hostedAccessHash).not.toBe(key);
    const retry = await prepareHostedPayment(d, { recoveryKey: key, payment });
    expect(retry.prepared.txHash).toBe(results[0]!.prepared.txHash);
    await expect(
      prepareHostedPayment(d, { recoveryKey: key, payment: { ...payment, amount: "101" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readHostedReceipt(d.id, "cd".repeat(32))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("owner opt-out racing the first send is fenced under its row lock; receipt stays recoverable", async () => {
    const d = await deployment(true);
    const prepared = await prepareHostedPayment(d, {
      recoveryKey: key,
      payment,
      ownershipProofXdr: ownership(d.id),
    });
    mocks.read.mockImplementationOnce(async () => {
      // The opt-out occurs after the route's visibility read, before the common send claim.
      await db.deployment.update({ where: { id: d.id }, data: { hostedExecutionEnabled: false } });
      return { ...hostedState, deploymentId: d.id };
    });
    const tx = TransactionBuilder.fromXDR(prepared.prepared.xdr, Networks.TESTNET) as Transaction;
    tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
    await expect(
      submitHostedPayment(
        d,
        { recoveryKey: key, intent: prepared.prepared.intent, signedXdr: tx.toXDR() },
        "test-ip",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await db.signedTransaction.count({ where: { deploymentId: d.id } })).toBe(0);
    expect((await readHostedReceipt(d.id, key)).state).toBe("PREPARED");
    const optedOut = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect((await reconcileHostedPayment(optedOut, key)).state).toBe("PREPARED");
    expect(await db.walletControlIntent.count({ where: { deploymentId: d.id } })).toBe(1);
  });
});
