import { randomUUID } from "node:crypto";
import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
import {
  admin,
  conditionalMutationFixture,
  conditionalMutationTransaction,
} from "./conditional-mutation-fixtures";

const mocks = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  current: vi.fn(),
  account: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
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
vi.mock("@/lib/redis", () => ({ redis: () => null }));
// The DB test calls real mutationAdmission directly, not the Next session route.
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ sendTransaction: mocks.send, getTransaction: mocks.get }),
}));
vi.mock("@/lib/stellar/conditional-mutation-state", () => ({
  readConditionalMutationState: mocks.current,
}));
vi.mock("@/lib/stellar/prepare-conditional-mutation", () => ({
  prepareConditionalMutationTransaction: mocks.prepare,
}));
vi.mock("@/lib/stellar/load-payment-account", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/load-payment-account")>()),
  loadPaymentAccount: mocks.account,
}));
import { db } from "@/lib/db";
import {
  createConditionalMutationIntent,
  prepareConditionalMutation,
  submitConditionalMutation,
  reconcileConditionalMutation,
  findConditionalMutationRetry,
} from "@/lib/mutations/conditional-service";
import { findMutationRetry } from "@/lib/mutations/service";
import { mutationAdmission } from "@/lib/mutations/http";
import { executionIdempotencyKey, executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  ConditionalMutationPrepareSchema,
  type ConditionalMutationState,
} from "@/lib/mutations/conditional-schema";

const scratch = scratchDatabase();
let deployment: Deployment;
let current: ConditionalMutationState;
let sequence = 10;
const admission = async (client: Parameters<typeof mutationAdmission>[0]) =>
  mutationAdmission(client, deployment);
beforeAll(async () => {
  mocks.client = await scratch.start();
});
afterAll(async () => {
  await scratch.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  const owner = await db.user.create({
    data: { username: `conditional-mutation-${randomUUID()}`, passwordHash: "unused" },
  });
  const flow = await db.flow.create({
    data: {
      ownerId: owner.id,
      name: "conditional mutation lifecycle",
      templateKind: "PAYER",
      graph: {},
      parameters: {},
    },
  });
  deployment = await db.deployment.create({
    data: {
      ownerId: owner.id,
      flowId: flow.id,
      status: "CONFIRMED",
      network: "testnet",
      sourceAccount: admin.publicKey(),
      graphSnapshot: {},
      paramsSnapshot: { version: 2, generation: "conditional-v2" },
      pipelineSnapshot: [],
    },
  });
  current = conditionalMutationFixture(deployment.id).current;
  mocks.current.mockResolvedValue(current);
  mocks.account.mockResolvedValue(new Account(admin.publicKey(), "10"));
  mocks.prepare.mockImplementation(async (mutation) =>
    conditionalMutationTransaction(mutation, String(sequence++)).toXDR(),
  );
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockImplementation(async (transaction: Transaction) => {
    const txHash = transaction.hash().toString("hex");
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
function request() {
  return {
    admin: admin.publicKey(),
    arguments: conditionalMutationFixture(deployment.id).mutation.arguments,
  };
}
const prepare = (key = "update:1", body = request()) =>
  prepareConditionalMutation(
    deployment,
    body,
    executionIdempotencyKey(key)!,
    admission,
    "127.0.0.1",
  );
function signed(
  prepared: Awaited<ReturnType<typeof prepare>>,
  signer = admin,
  passphrase = Networks.TESTNET,
) {
  const tx = TransactionBuilder.fromXDR(prepared.xdr, passphrase) as Transaction;
  tx.sign(signer);
  return tx.toXDR();
}
const submit = (prepared: Awaited<ReturnType<typeof prepare>>, signedXdr = signed(prepared)) =>
  submitConditionalMutation({
    deployment,
    intent: prepared.intent,
    signedXdr,
    ip: "127.0.0.1",
    ownerSessionId: deployment.ownerId,
    assertAdmission: admission,
  });
function proof(error: unknown) {
  if (!(error instanceof AppError) || !error.fields?.preparationRefusal)
    throw new Error("Expected durable refusal");
  return JSON.parse(error.fields.preparationRefusal[0]!);
}

describe("conditional mutation durable original lifecycle", () => {
  it("serializes samekey replicas, persists fullgraph original and never creates a second update", async () => {
    const prepared = await Promise.all([prepare(), prepare(), prepare()]);
    expect(new Set(prepared.map((value) => value.intent)).size).toBe(1);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
    expect(prepared[0]!.mutation.nodes).toHaveLength(5);
    expect(prepared[0]!.mutation.definition.falseBranch).toBeDefined();
    const body = request();
    body.arguments.changes = body.arguments.changes.slice(1);
    await expect(prepare("update:1", body)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      findMutationRetry(
        deployment.id,
        executionIdempotencyKey("update:1")!,
        executionRequestDigest({
          version: 2,
          deploymentId: deployment.id,
          network: deployment.network,
          input: request(),
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("requires one unresolved group per graph even with a new key, and recovers original before failed currentread", async () => {
    const first = await prepare();
    await expect(prepare("update:2")).rejects.toMatchObject({
      code: "CONFLICT",
      fields: { intent: [first.intent], txHash: [first.txHash] },
    });
    mocks.current.mockRejectedValue(new AppError("UPSTREAM_RPC", "offline"));
    expect(await prepare()).toEqual(first);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });
  it.each([1, 3, 4])(
    "fences graph obligation at node%s before accountlookup failures without consulting raw balances",
    async (index) => {
      current.statuses[index]!.obligationsStroops = "1";
      mocks.current.mockImplementation(async (_deployment, finalRead) => {
        await finalRead();
        return current;
      });
      mocks.account.mockRejectedValue(new AppError("INSUFFICIENT_FUNDS", "account missing"));
      const refusal = await prepare().catch((error) => error);
      expect(refusal).toMatchObject({ code: "CONFLICT" });
      expect(proof(refusal).version).toBe(2);
      expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(
        0,
      );
      expect(mocks.prepare).not.toHaveBeenCalled();
      current.statuses[index]!.obligationsStroops = "0";
      await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );
  it.each(["constant", "noop", "stale", "overflow"])(
    "records policy%s refusal as validation/conflict before account errors",
    async (attack) => {
      const body = request();
      const condition = body.arguments.changes.find((change) => change.kind === "condition")!;
      if (condition.kind !== "condition") throw new Error();
      if (attack === "constant") current.definition.condition.thresholdMode = "constant";
      if (attack === "noop")
        condition.thresholdStroops = current.definition.condition.thresholdStroops;
      if (attack === "stale") current.nodes[2]!.expectedRevision = "2";
      if (attack === "overflow") {
        current.nodes[2]!.expectedRevision = (2n ** 64n - 1n).toString();
        condition.expectedRevision = current.nodes[2]!.expectedRevision;
      }
      mocks.current.mockImplementation(async (_deployment, finalRead) => {
        await finalRead();
        return current;
      });
      mocks.account.mockRejectedValue(new AppError("INSUFFICIENT_FUNDS", "missing"));
      const refusal = await prepare("policy", body).catch((error) => error);
      expect(refusal).toMatchObject({ code: attack === "stale" ? "CONFLICT" : "VALIDATION" });
      expect(proof(refusal).reasonCode).toBe(attack === "stale" ? "CONFLICT" : "VALIDATION");
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );
  it.each(["0", (2n ** 127n - 1n).toString()])(
    "preserves threshold%s and arbitrary unique row patch order in exact receipts",
    async (threshold) => {
      const body = request();
      const condition = body.arguments.changes.find((change) => change.kind === "condition")!;
      if (condition.kind !== "condition") throw new Error();
      condition.thresholdStroops = threshold;
      for (const change of body.arguments.changes)
        if (change.kind === "split") change.rows.reverse();
      const prepared = await prepare("max", body);
      expect(prepared.mutation.arguments).toEqual(body.arguments);
      expect(prepared.mutation.definition.trueBranch.kind).toBe("split");
    },
  );
  it("blocks a delayed creator after a competing failure established immutable nonadmission", async () => {
    let release!: (value: ConditionalMutationState) => void;
    const pending = new Promise<ConditionalMutationState>((resolve) => {
      release = resolve;
    });
    mocks.current
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new AppError("UPSTREAM_RPC", "offline"));
    const late = prepare("race").then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    while (mocks.current.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const refused = await prepare("race").catch((error) => error);
    const firstProof = proof(refused);
    release(current);
    const result = await late;
    if (!("error" in result)) throw new Error("Late creator admitted");
    expect(proof(result.error).refusalId).toBe(firstProof.refusalId);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });
  it("lets an admitted original win over a delayed failing preparation with the same key", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<ConditionalMutationState>((_resolve, reject_) => {
      reject = reject_;
    });
    mocks.current.mockReturnValueOnce(pending).mockResolvedValueOnce(current);
    const delayed = prepare("winner");
    while (mocks.current.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const admitted = await prepare("winner");
    reject(new AppError("UPSTREAM_RPC", "late read failed"));
    expect(await delayed).toEqual(admitted);
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
  });
  it.each(["inactive-revision", "inactive-pin", "threshold", "obligation"])(
    "first send refuses changed%s without replacing canonical evidence",
    async (attack) => {
      const prepared = await prepare();
      if (attack === "inactive-revision") current.nodes[4]!.expectedRevision = "1";
      if (attack === "inactive-pin") current.nodes[4]!.wasmHash = "cd".repeat(32);
      if (attack === "threshold") current.definition.condition.thresholdStroops = "51";
      if (attack === "obligation") current.statuses[4]!.obligationsStroops = "1";
      await expect(submit(prepared)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(
        await db.walletControlIntent.findUniqueOrThrow({ where: { id: prepared.intent } }),
      ).toMatchObject({ state: "PREPARED", txHash: prepared.txHash });
    },
  );
  it.each(["wrong-key", "wrong-network"])(
    "refuses%s signature before claim or send",
    async (attack) => {
      const prepared = await prepare();
      const wire =
        attack === "wrong-key"
          ? signed(prepared, Keypair.random())
          : signed(prepared, admin, Networks.PUBLIC);
      await expect(submit(prepared, wire)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it("sends one original, preserves unknown transport and reconciles after currentstate failure", async () => {
    const prepared = await prepare();
    mocks.send.mockRejectedValue(new Error("response lost"));
    const results = await Promise.all([submit(prepared), submit(prepared)]);
    expect(results.every((value) => value.txHash === prepared.txHash)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    mocks.current.mockRejectedValue(new AppError("UPSTREAM_RPC", "offline"));
    await submit(prepared);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    mocks.get.mockResolvedValue({ status: "FAILED", ledger: 150 });
    expect(await reconcileConditionalMutation(deployment, prepared.intent)).toMatchObject({
      state: "FAILED",
      transaction: { txHash: prepared.txHash, status: "FAILED" },
    });
  });
  it("does not manufacture nonadmission for unknown exceptions or revoked/retired admission", async () => {
    mocks.current.mockRejectedValue(new Error("unexpected"));
    await expect(prepare()).rejects.toThrow("unexpected");
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
    mocks.current.mockRejectedValue(new AppError("UPSTREAM_RPC", "offline"));
    await db.user.update({ where: { id: deployment.ownerId }, data: { isActive: false } });
    await expect(prepare()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
    await db.user.update({ where: { id: deployment.ownerId }, data: { isActive: true } });
    await db.deployment.update({
      where: { id: deployment.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
