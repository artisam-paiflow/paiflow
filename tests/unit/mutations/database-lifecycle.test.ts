import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  get: vi.fn(),
  current: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/stellar/mutation-state", () => ({ readMutationState: mocks.current }));
vi.mock("@/lib/stellar/prepare-mutation", () => ({ prepareMutationTransaction: mocks.prepare }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
import { db } from "@/lib/db";
import {
  prepareMutation,
  createMutationIntent,
  submitMutation,
  findMutationRetry,
  reconcileMutation,
} from "@/lib/mutations/service";
import { configurationHistory, recordConfigurationObservation } from "@/lib/mutations/history";
import { projectConfigurationEvent } from "@/lib/stellar/configuration-events";
import { executionIdempotencyKey } from "@/lib/api/v1/execution-intent";
import { reconcileControlIntent, recordControlFinality } from "@/lib/api/v1/control-intent";
import { mutationV1Args } from "@/lib/stellar/execution-v1";
import {
  admin,
  configuration,
  graph,
  current,
  intent,
  nextRecipient,
  recipient,
  root,
  pay,
  asset,
  snapshot,
  transaction,
} from "./fixtures";
let ownerId: string, flowId: string, deployment: Deployment;
const admission = async (_tx: Prisma.TransactionClient) => {};
beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `mutations-${randomUUID()}`, passwordHash: "unused" },
    })
  ).id;
  flowId = (
    await db.flow.create({
      data: { ownerId, name: "mutation tests", templateKind: "PAYER", graph: {}, parameters: {} },
    })
  ).id;
});
beforeEach(async () => {
  vi.clearAllMocks();
  deployment = await db.deployment.create({
    data: {
      ownerId,
      flowId,
      network: "testnet",
      status: "CONFIRMED",
      sourceAccount: admin.publicKey(),
      graphSnapshot: graph as unknown as Prisma.InputJsonValue,
      pipelineSnapshot: snapshot,
      paramsSnapshot: [],
    },
  });
  mocks.current.mockImplementation(async () => current(deployment));
  mocks.prepare.mockImplementation(async (mutation) => transaction(mutation).toXDR());
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockResolvedValue({ status: "PENDING" });
});
afterEach(async () => {
  if (!deployment) return;
  await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: deployment.id } } });
  await db.deploymentWork.deleteMany({ where: { deploymentId: deployment.id } });
  await db.walletControlIntent.deleteMany({ where: { deploymentId: deployment.id } });
  await db.signedTransaction.deleteMany({ where: { deploymentId: deployment.id } });
  await db.configurationHistory.deleteMany({ where: { deploymentId: deployment.id } });
  await db.contractEvent.deleteMany({ where: { deploymentId: deployment.id } });
  await db.auditLog.deleteMany({
    where: { metadata: { path: ["deploymentId"], equals: deployment.id } },
  });
  await db.deployment.delete({ where: { id: deployment.id } });
});
afterAll(async () => {
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: ownerId } });
});
const prepare = (key = "mutation:1") =>
  prepareMutation(
    deployment,
    { admin: admin.publicKey(), arguments: intent(deployment).arguments },
    executionIdempotencyKey(key)!,
    admission,
    "127.0.0.1",
  );
const send = async (data: Awaited<ReturnType<typeof prepare>>, signer = admin) => {
  const tx = TransactionBuilder.fromXDR(data.xdr, Networks.TESTNET) as Transaction;
  tx.sign(signer);
  return submitMutation({
    deployment,
    intent: data.intent,
    signedXdr: tx.toXDR(),
    ownerSessionId: ownerId,
    assertAdmission: admission,
    ip: "127.0.0.1",
  });
};
describe("admin mutation durable lifecycle", () => {
  it("serializes concurrent same-key admission and retains original reviewed body on retry", async () => {
    const prepared = await Promise.all([prepare(), prepare(), prepare()]);
    expect(new Set(prepared.map((p) => p.intent)).size).toBe(1);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
    await expect(
      prepareMutation(
        deployment,
        {
          admin: admin.publicKey(),
          arguments: {
            version: 1,
            changes: [{ kind: "pay", nodeId: "pay", expectedRevision: "0", recipient }],
          },
        },
        executionIdempotencyKey("mutation:1")!,
        admission,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const before = mocks.current.mock.calls.length;
    expect((await prepare()).txHash).toBe(prepared[0]!.txHash);
    expect(mocks.current).toHaveBeenCalledTimes(before);
  });
  it("persists exact evidence, audit and financial work before single send across racing submissions", async () => {
    const data = await prepare();
    mocks.send.mockImplementation(async () => {
      expect(
        await db.walletControlIntent.count({ where: { id: data.intent, state: "SUBMITTING" } }),
      ).toBe(1);
      expect(
        await db.signedTransaction.count({
          where: { deploymentId: deployment.id, txHash: data.txHash },
        }),
      ).toBe(1);
      expect(
        await db.serviceTransaction.count({ where: { txHash: data.txHash, state: "PENDING" } }),
      ).toBe(1);
      return { status: "PENDING" };
    });
    await Promise.all([send(data), send(data)]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      await db.auditLog.count({
        where: {
          userId: ownerId,
          action: "DEPLOY_INVOKE",
          metadata: { path: ["txHash"], equals: data.txHash },
        },
      }),
    ).toBe(1);
  });
  it("requires source admin signature and rejects exact-body changes without sending", async () => {
    const data = await prepare();
    await expect(send(data, Keypair.random())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tx = transaction({
      ...intent(deployment),
      arguments: {
        version: 1,
        changes: [{ kind: "pay", nodeId: "pay", expectedRevision: "0", recipient }],
      },
    });
    tx.sign(admin);
    await expect(
      submitMutation({
        deployment,
        intent: data.intent,
        signedXdr: tx.toXDR(),
        ownerSessionId: ownerId,
        assertAdmission: admission,
        ip: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects stale state, obligations, wrong admin and retired service before signing/send", async () => {
    mocks.current.mockResolvedValue({
      ...current(deployment),
      obligations: [{ nodeId: "pay", obligationsStroops: "1" }],
    });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue({
      ...current(deployment),
      admin: Keypair.random().publicKey(),
    });
    await expect(prepare()).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.current.mockResolvedValue(current(deployment));
    const data = await prepare();
    const stale = current(deployment);
    stale.nodes[1]!.expectedRevision = "1";
    stale.configurations[0]!.revision = "1";
    mocks.current.mockResolvedValue(stale);
    await expect(send(data)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue(current(deployment));
    await db.deployment.update({
      where: { id: deployment.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await expect(send(data)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["ERROR", "TRY_AGAIN_LATER", "transport"])(
    "preserves unknown %s identity and refuses another key/resend",
    async (status) => {
      const data = await prepare();
      if (status === "transport") mocks.send.mockRejectedValue(new Error("offline"));
      else mocks.send.mockResolvedValue({ status });
      const result = await send(data);
      expect(["UNKNOWN", "REJECTED"]).toContain(result.status);
      expect(
        (await db.walletControlIntent.findUniqueOrThrow({ where: { id: data.intent } })).state,
      ).toBe("SUBMITTING");
      await expect(prepare("new-key")).rejects.toMatchObject({ code: "CONFLICT" });
      await send(data);
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(
        await db.serviceTransaction.count({ where: { txHash: data.txHash, state: "PENDING" } }),
      ).toBe(1);
    },
  );
  it("records actual FAILED finality and does not infer a confirmed configuration", async () => {
    const data = await prepare();
    await send(data);
    mocks.get.mockResolvedValue({ status: "FAILED", ledger: 101 });
    const result = await reconcileMutation(deployment, data.intent);
    expect(result.state).toBe("FAILED");
    expect(result.transaction.status).toBe("FAILED");
    expect(await db.configurationHistory.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });
  it("rejects foreign deployment preparation/reconciliation and credentials before financial admission", async () => {
    const data = await prepare();
    await expect(
      reconcileControlIntent(data.intent, randomUUID(), "configuration.mutate"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createMutationIntent({
        deployment,
        mutation: { ...intent(deployment), admin: Keypair.random().publicKey() },
        unsignedXdr: data.xdr,
        preparationLedger: 100,
        keyHash: executionIdempotencyKey("different")!,
        requestDigest: "a".repeat(64),
        assertAdmission: admission,
        ip: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      findMutationRetry(deployment.id, executionIdempotencyKey("mutation:1")!, "b".repeat(64)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("never treats unsupported or failed simulation as a reservation", async () => {
    mocks.prepare.mockRejectedValue(new Error("simulation failed"));
    await expect(prepare()).rejects.toBeDefined();
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });
});
describe("confirmed revision observations and direct-chain receipts", () => {
  it("keeps current and older direct-event revisions separately and reports missing revisions", async () => {
    const latest = structuredClone(configuration);
    latest.revision = "3";
    latest.confirmedLedger = 130;
    if (latest.configuration.kind === "pay") latest.configuration.recipient = nextRecipient;
    await recordConfigurationObservation(deployment.id, latest);
    await recordConfigurationObservation(deployment.id, {
      ...configuration,
      revision: "1",
      confirmedLedger: 110,
    });
    const result = await configurationHistory(deployment.id, { limit: 20 });
    expect(result.historyComplete).toBe(false);
    expect(result.revisionCoverage).toEqual([
      {
        nodeId: "pay",
        highestObservedRevision: "3",
        observedRevisionCount: "2",
        missingRevisionCount: "2",
      },
    ]);
    expect(result.items[0]!.configuration).toMatchObject({ revision: "3" });
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } })).graphSnapshot,
    ).toEqual(graph);
    await expect(
      recordConfigurationObservation(deployment.id, { ...configuration, revision: "3" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("projects actual config_v1 data including a directly submitted update and replay evidence", async () => {
    const event = await db.contractEvent.create({
      data: {
        deploymentId: deployment.id,
        eventId: randomUUID(),
        kind: "STATUS_CHANGE",
        ledger: 101,
        txHash: "ab".repeat(32),
        occurredAt: new Date(),
        payload: {
          topics: ["config_v1", "pay"],
          contractAddress: pay,
          value: {
            policy: {
              version: 1,
              node_id: "pay",
              recipient_mode: ["Mutable"],
              payout_value_mode: ["Mutable"],
              recipient: nextRecipient,
              payout_rule: ["Fixed", "200"],
            },
            revision: "1",
            asset,
            parent: root,
            next_steps: [],
            amount: "200",
            percentage_bps: 0,
          },
        },
      },
    });
    await projectConfigurationEvent(event);
    await projectConfigurationEvent(event);
    const rows = await configurationHistory(deployment.id, { limit: 20 });
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({
      eventId: event.eventId,
      txHash: event.txHash,
      eventLedger: 101,
      configuration: {
        revision: "1",
        configuration: { recipient: nextRecipient, payoutValue: { amountStroops: "200" } },
      },
    });
  });
  it("retains history through retirement and rejects foreign cursors and immutable rewrite", async () => {
    await recordConfigurationObservation(deployment.id, configuration);
    const row = await db.configurationHistory.findFirstOrThrow({
      where: { deploymentId: deployment.id },
    });
    await db.deployment.update({
      where: { id: deployment.id },
      data: {
        serviceState: "RETIRED",
        retirementRequestedAt: new Date(),
        retiredAt: new Date(),
        retirementReconciledAt: new Date(),
      },
    });
    expect((await configurationHistory(deployment.id, { limit: 1 })).items).toHaveLength(1);
    await expect(
      configurationHistory(randomUUID(), { limit: 20, cursor: row.id }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      db.configurationHistory.update({ where: { id: row.id }, data: { revision: "2" } }),
    ).rejects.toThrow();
  });
});
