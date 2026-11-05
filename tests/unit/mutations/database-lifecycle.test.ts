import { randomUUID, createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, Prisma, PrismaClient } from "@prisma/client";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
const mocks = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  send: vi.fn(),
  get: vi.fn(),
  current: vi.fn(),
  prepare: vi.fn(),
  account: vi.fn(),
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
vi.mock("@/lib/stellar/load-payment-account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/load-payment-account")>()),
  loadPaymentAccount: mocks.account,
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
import {
  executionIdempotencyKey,
  executionRequestDigest,
  createExecutionIntent,
} from "@/lib/api/v1/execution-intent";
import { ExecutionIntentSchema } from "@/lib/flows/field-policies";
import { AppError } from "@/lib/errors";
import { observeRpcPhase } from "@/lib/stellar/rpc-phase";
import {
  withInteractiveRpcBudget,
  remainingInteractiveRpcMs,
} from "@/lib/stellar/interactive-rpc-budget";
import { reconcileControlIntent, recordControlFinality } from "@/lib/api/v1/control-intent";
import { mutationV1Args, executionV1Args } from "@/lib/stellar/execution-v1";
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
let ownerId: string,
  flowId: string,
  deployment: Deployment,
  sequence = 10;
const admission = async (_tx: Prisma.TransactionClient) => {};
const scratch = scratchDatabase();
beforeAll(async () => {
  mocks.client = await scratch.start();
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
  mocks.account.mockResolvedValue(new Account(admin.publicKey(), "10"));
  mocks.prepare.mockImplementation(async (mutation) =>
    new TransactionBuilder(new Account(mutation.admin, String(sequence++)), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(mutation.rootContract).call(
          "mutate_v1",
          ...mutationV1Args(mutation.nodes, mutation.arguments),
        ),
      )
      .setTimeout(180)
      .build()
      .toXDR(),
  );
  mocks.get.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockResolvedValue({ status: "PENDING" });
});
afterAll(async () => {
  await scratch.stop();
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
  it("passes the overlapped admin account into transaction preparation", async () => {
    mocks.current.mockImplementation(async (_deployment, finalRead) => {
      await finalRead?.();
      return current(deployment);
    });
    await prepare();
    expect(mocks.account).toHaveBeenCalledOnce();
    expect(mocks.prepare.mock.calls[0]![1].accountId()).toBe(admin.publicKey());
  });
  it("discards a failed account prefetch when a later observation retries successfully", async () => {
    mocks.account
      .mockRejectedValueOnce(new AppError("UPSTREAM_RPC", "Temporary account failure"))
      .mockResolvedValueOnce(new Account(admin.publicKey(), "22"));
    mocks.current.mockImplementation(async (_deployment, finalRead) => {
      await finalRead(); // First closing fence rejects this observation after the account failure.
      await finalRead(); // Stable retry has a new successful account observation.
      return current(deployment);
    });
    await prepare();
    expect(mocks.account).toHaveBeenCalledTimes(2);
    expect(mocks.prepare.mock.calls[0]![1].sequenceNumber()).toBe("22");
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
  });
  it.each(["obligations", "invalid-change", "unsupported"] as const)(
    "preserves %s refusal precedence when the overlapped account lookup fails",
    async (case_) => {
      mocks.account.mockRejectedValue(new AppError("INSUFFICIENT_FUNDS", "Source missing"));
      mocks.current.mockImplementation(async (_deployment, finalRead) => {
        await finalRead?.();
        if (case_ === "unsupported") throw new AppError("VALIDATION", "No guarded capability");
        const state = current(deployment);
        if (case_ === "obligations") state.obligations[0]!.obligationsStroops = "1";
        return state;
      });
      const request = { admin: admin.publicKey(), arguments: intent(deployment).arguments };
      if (case_ === "invalid-change") request.arguments.changes[0]!.nodeId = "foreign";
      const code = case_ === "obligations" ? "CONFLICT" : "VALIDATION";
      await expect(
        prepareMutation(
          deployment,
          request,
          executionIdempotencyKey("precedence")!,
          admission,
          "127.0.0.1",
        ),
      ).rejects.toMatchObject({ code });
      expect(mocks.account).toHaveBeenCalledOnce();
      expect(mocks.prepare).not.toHaveBeenCalled();
      const refusal = await db.mutationPreparationRefusal.findFirstOrThrow({
        where: { deploymentId: deployment.id },
      });
      expect(refusal.reasonCode).toBe(code);
      expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(
        0,
      );
    },
  );
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
    await expect(prepare("wrong-admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.current.mockResolvedValue(current(deployment));
    const data = await prepare("fresh-reviewed-update");
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
  it("fences a refused key before a delayed same-key simulation can admit", async () => {
    let release: () => void = () => {},
      started: () => void = () => {};
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.prepare.mockImplementationOnce(
      (mutation) =>
        new Promise<string>((resolve) => {
          release = () => resolve(transaction(mutation).toXDR());
          started();
        }),
    );
    const late = prepare("race-refusal").then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await began;
    mocks.prepare.mockRejectedValueOnce(new AppError("VALIDATION", "Original simulation refused"));
    const refusal = await prepare("race-refusal").catch((error) => error as AppError);
    expect(refusal).toBeInstanceOf(AppError);
    const proof = JSON.parse((refusal as AppError).fields!.preparationRefusal![0]!);
    release();
    const delayed = await late;
    expect(delayed.value).toBeNull();
    expect(JSON.parse(delayed.error.fields.preparationRefusal[0]).refusalId).toBe(proof.refusalId);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(1);
    const before = mocks.current.mock.calls.length;
    await expect(prepare("race-refusal")).rejects.toMatchObject({
      fields: { preparationRefusal: [JSON.stringify(proof)] },
    });
    expect(mocks.current.mock.calls.length).toBe(before);
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
        executionIdempotencyKey("race-refusal")!,
        admission,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", fields: undefined });
  });
  it.each(["before", "after"] as const)(
    "durably refuses a preparation when the deadline expires %s mutation simulation",
    async (when) => {
      const simulate = vi.fn(async () => {
        const xdr = transaction(intent(deployment)).toXDR();
        await new Promise((resolve) => setTimeout(resolve, remainingInteractiveRpcMs() + 5));
        return xdr;
      });
      mocks.prepare.mockImplementationOnce(() =>
        withInteractiveRpcBudget(
          () => observeRpcPhase("mutation.simulation", deployment.id, simulate),
          when === "before" ? 0 : 25,
        ),
      );
      const error = await prepare("local-deadline").catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
      if (!(error instanceof AppError)) throw new Error("Expected durable preparation refusal");
      const proof = JSON.parse(error.fields!.preparationRefusal![0]!);
      expect(proof).toMatchObject({
        outcome: "NOT_ADMITTED",
        deploymentId: deployment.id,
        reasonCode: "UPSTREAM_RPC",
      });
      expect(simulate).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
      expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(
        0,
      );
      expect(
        await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
      ).toBe(1);
      const reads = mocks.current.mock.calls.length;
      await expect(prepare("local-deadline")).rejects.toMatchObject({
        fields: { preparationRefusal: [JSON.stringify(proof)] },
      });
      expect(mocks.current).toHaveBeenCalledTimes(reads);
    },
  );
  it.each(["VALIDATION", "UPSTREAM_RPC", "INSUFFICIENT_FUNDS"] as const)(
    "preserves first-failure %s status and useful fields with additive refusal proof",
    async (code) => {
      const original = new AppError(
        code,
        "Useful safe preparation reason",
        { arguments: ["Review the proposed allocation"] },
        "public contract diagnostic",
      );
      mocks.prepare.mockRejectedValueOnce(original);
      const error = await prepare(`reason-${code}`).catch((e) => e as AppError);
      expect(error).toMatchObject({
        code,
        status: original.status,
        message: original.message,
        details: original.details,
        fields: { arguments: ["Review the proposed allocation"] },
      });
      const proof = JSON.parse((error as AppError).fields!.preparationRefusal![0]!);
      expect(proof.reasonCode).toBe(code);
      const retry = await prepare(`reason-${code}`).catch((e) => e as AppError);
      expect((retry as AppError).code).toBe(code);
      expect((retry as AppError).details).toBeUndefined();
      expect(JSON.parse((retry as AppError).fields!.preparationRefusal![0]!).refusalId).toBe(
        proof.refusalId,
      );
    },
  );
  it("returns an admitted original intent when a concurrent preflight later fails", async () => {
    let reject: (error: Error) => void = () => {},
      started: () => void = () => {};
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.prepare.mockImplementationOnce(
      () =>
        new Promise<string>((_, fail) => {
          reject = fail;
          started();
        }),
    );
    const slow = prepare("admission-wins");
    await began;
    const admitted = await prepare("admission-wins");
    reject(new AppError("VALIDATION", "A concurrent simulation refused"));
    expect((await slow).intent).toBe(admitted.intent);
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(1);
  });
  it("retains refusal evidence immutably and fences the shared execution keyspace", async () => {
    mocks.prepare.mockRejectedValueOnce(new AppError("VALIDATION", "Refused before admission"));
    await expect(prepare("shared-refused-key")).rejects.toMatchObject({ code: "VALIDATION" });
    const refusal = await db.mutationPreparationRefusal.findFirstOrThrow({
      where: { deploymentId: deployment.id },
    });
    await expect(
      db.mutationPreparationRefusal.update({
        where: { id: refusal.id },
        data: { requestDigest: "a".repeat(64) },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.mutationPreparationRefusal.delete({ where: { id: refusal.id } }),
    ).rejects.toBeDefined();
    const execution = ExecutionIntentSchema.parse({
      version: 1,
      deploymentId: deployment.id,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
      rootContract: root,
      assetContract: asset,
      payer: admin.publicKey(),
      amountStroops: "100",
      nonce: "ab".repeat(32),
      expiresAtLedger: 110,
      nodes: current(deployment).nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
        nodeId,
        contractAddress,
        expectedRevision,
      })),
      arguments: { version: 1, inputs: [] },
    });
    const tx = new TransactionBuilder(new Account(admin.publicKey(), "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(root).call("execute_v1", ...executionV1Args(execution)))
      .setTimeout(180)
      .build();
    await expect(
      createExecutionIntent({
        deployment,
        execution,
        artifacts: intent(deployment).artifacts,
        unsignedXdr: tx.toXDR(),
        preparationLedger: 100,
        keyHash: executionIdempotencyKey("shared-refused-key"),
        requestDigest: executionRequestDigest(execution),
        assertAdmission: admission,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.walletControlIntent.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });
  it("issues no refusal proof for unknown exceptions, removed admission or retired service", async () => {
    const unexpected = new Error("Unexpected current-reader programming or database error");
    mocks.current.mockRejectedValueOnce(unexpected);
    await expect(prepare("unexpected-reader-error")).rejects.toBe(unexpected);
    mocks.prepare.mockRejectedValueOnce(new TypeError("unexpected programming failure"));
    const unknown = await prepare("unknown-error").catch((error) => error as AppError);
    expect((unknown as AppError).fields?.preparationRefusal).toBeUndefined();
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
    mocks.current.mockResolvedValue({
      ...current(deployment),
      obligations: [{ nodeId: "pay", obligationsStroops: "1" }],
    });
    await expect(
      prepareMutation(
        deployment,
        { admin: admin.publicKey(), arguments: intent(deployment).arguments },
        executionIdempotencyKey("removed-access")!,
        async () => {
          throw new AppError("FORBIDDEN", "Access removed");
        },
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
    await db.deployment.update({
      where: { id: deployment.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    const retired = await prepare("retired-refusal").catch((error) => error as AppError);
    expect((retired as AppError).fields?.preparationRefusal).toBeUndefined();
    expect(
      await db.mutationPreparationRefusal.count({ where: { deploymentId: deployment.id } }),
    ).toBe(0);
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
