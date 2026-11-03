import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment, WalletControlIntent } from "@prisma/client";
import { AppError } from "@/lib/errors";
const mocks = vi.hoisted(() => ({
  db: {
    deployment: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    walletControlIntent: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
  state: vi.fn(),
  work: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/api/v1/execution-payments", () => ({
  prepareExecutionPayment: mocks.prepare,
  submitExecutionPayment: mocks.submit,
}));
vi.mock("@/lib/stellar/execution-state", () => ({ readExecutionState: mocks.state }));
vi.mock("@/lib/api/v1/control-intent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/v1/control-intent")>()),
  reconcileControlIntent: mocks.reconcile,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  lockDeployment: mocks.lock,
  withDeploymentWork: mocks.work,
}));
import {
  hostedDeployment,
  hostedKeyHash,
  prepareHostedPayment,
  readHostedReceipt,
  reconcileHostedPayment,
  setHostedVisibility,
  submitHostedPayment,
} from "@/lib/hosted-execution/service";
import { deploymentId, hostedState, payment, preparation, intentId } from "./fixtures";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import { createHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership";
import { Keypair, TransactionBuilder, Networks, type Transaction } from "@stellar/stellar-sdk";

const key = "ab".repeat(32);
let deployment: Deployment;
let row: WalletControlIntent;
beforeEach(() => {
  vi.clearAllMocks();
  deployment = {
    id: deploymentId,
    ownerId: "owner",
    network: "testnet",
    status: "CONFIRMED",
    serviceState: "ACTIVE",
    hostedExecutionEnabled: true,
    graphSnapshot: {
      fieldPolicies: { version: 1, nodes: [] },
      privateEmail: "private@example.test",
    },
    webhookSecret: "never-public",
    chargeRelayerToken: "secret",
  } as unknown as Deployment;
  row = {
    id: intentId,
    deploymentId,
    network: "testnet",
    action: "payment.execute",
    txHash: preparation(payment).prepared.txHash,
    state: "PREPARED",
    maxTime: `${Math.floor(Date.now() / 1000) + 180}`,
    hostedAccessHash: hostedKeyHash(key),
    idempotencyKeyHash: createHash("sha256").update(`hosted-execution:${key}`).digest("hex"),
    walletAddress: payment.from,
    requestDigest: executionRequestDigest({ deploymentId, network: "testnet", input: payment }),
  } as WalletControlIntent;
  mocks.db.deployment.findFirst.mockImplementation(async () => deployment);
  mocks.db.deployment.findUnique.mockImplementation(async () => ({
    hostedExecutionEnabled: deployment.hostedExecutionEnabled,
  }));
  mocks.db.walletControlIntent.findFirst.mockImplementation(async () => row);
  mocks.db.walletControlIntent.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.lock.mockResolvedValue({ serviceState: "ACTIVE" });
  mocks.work.mockImplementation(async (_id, _kind, callback) => callback());
  mocks.state.mockResolvedValue(hostedState);
  mocks.prepare.mockResolvedValue(preparation(payment).prepared);
  mocks.submit.mockResolvedValue({
    txHash: row.txHash,
    status: "UNKNOWN",
    events: [{ email: "private@example.test" }],
    diagnostics: "not public",
  });
  mocks.reconcile.mockImplementation(async () => row);
});

describe("public payment admission and receipts", () => {
  it("refuses anonymous victim preparation before simulation, reservation or receipt writes", async () => {
    mocks.db.walletControlIntent.findFirst.mockResolvedValue(null);
    await expect(
      prepareHostedPayment(deployment, { recoveryKey: key, payment }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.db.walletControlIntent.updateMany).not.toHaveBeenCalled();
  });
  it("requires a valid payer proof on first preparation and rechecks expiry at admission", async () => {
    mocks.db.walletControlIntent.findFirst.mockResolvedValueOnce(null);
    const challenge = createHostedOwnershipChallenge(deploymentId, { recoveryKey: key, payment });
    const tx = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET) as Transaction;
    tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
    await prepareHostedPayment(deployment, {
      recoveryKey: key,
      payment,
      ownershipProofXdr: tx.toXDR(),
    });
    const admission = mocks.prepare.mock.calls[0]?.[3];
    vi.spyOn(Date, "now").mockReturnValue((Number(tx.timeBounds!.maxTime) + 1) * 1000);
    try {
      await expect(admission(mocks.db)).rejects.toMatchObject({ code: "VALIDATION" });
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("recovers exact persisted preparation without a fresh proof, including a crash before capability marking", async () => {
    row.hostedAccessHash = null;

    await expect(
      prepareHostedPayment(deployment, { recoveryKey: key, payment }),
    ).resolves.toHaveProperty("prepared.intent", intentId);
    await expect(
      prepareHostedPayment(deployment, {
        recoveryKey: key,
        payment: { ...payment, amount: "101" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["disabled", "retiring", "retired", "legacy", "missing"])(
    "refuses new public payment for %s",
    async (variant) => {
      if (variant === "disabled") deployment.hostedExecutionEnabled = false;
      if (variant === "retiring") deployment.serviceState = "RETIRING";
      if (variant === "retired") deployment.serviceState = "RETIRED";
      if (variant === "legacy") deployment.graphSnapshot = {};
      if (variant === "missing") mocks.db.deployment.findFirst.mockResolvedValue(null);
      await expect(hostedDeployment(deploymentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );
  it("requires the scoped capability and uses a hashed, namespaced idempotency identity", async () => {
    await readHostedReceipt(deploymentId, key);
    expect(mocks.db.walletControlIntent.findFirst).toHaveBeenCalledWith({
      where: {
        deploymentId,
        network: "testnet",
        action: "payment.execute",
        idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(mocks.db.walletControlIntent.findFirst.mock.calls)).not.toContain(key);
    await expect(readHostedReceipt(deploymentId, "cd".repeat(32))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    row.hostedAccessHash = null;
    expect((await readHostedReceipt(deploymentId, key)).id).toBe(intentId);
    await expect(readHostedReceipt(deploymentId, "cd".repeat(32))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    row.idempotencyKeyHash = "ef".repeat(32);
    await expect(readHostedReceipt(deploymentId, key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("reuses the shared preparation and returns only public review, not credentials or contacts", async () => {
    const result = await prepareHostedPayment(deployment, { recoveryKey: key, payment });
    expect(result.rows[0]?.recipient).toBe(payment.arguments.inputs[0]?.recipient);
    expect(result.feeStroops).toBe("100");
    expect(mocks.prepare).toHaveBeenCalledWith(
      deployment,
      payment,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Function),
      hostedKeyHash(key),
    );
    const serialized = JSON.stringify(result);
    for (const secret of [
      key,
      "never-public",
      "private@example.test",
      "chargeRelayerToken",
      "ownerId",
    ])
      expect(serialized).not.toContain(secret);
    expect(mocks.db.walletControlIntent.updateMany).not.toHaveBeenCalled();
  });
  it("under-lock preparation admission refuses an owner opt-out race", async () => {
    await prepareHostedPayment(deployment, { recoveryKey: key, payment });
    const admission = mocks.prepare.mock.calls[0]?.[3];
    deployment.hostedExecutionEnabled = false;
    await expect(admission(mocks.db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects stale reviewed revisions without supplying a signing response", async () => {
    mocks.state.mockResolvedValue({
      ...hostedState,
      nodes: hostedState.nodes.map((node) => ({ ...node, expectedRevision: "1" })),
    });
    await expect(
      prepareHostedPayment(deployment, { recoveryKey: key, payment }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("recovers the original durable preparation after a late review 502 and owner opt-out", async () => {
    // First admission is not visible until the shared prepare commits its original row.
    mocks.db.walletControlIntent.findFirst.mockResolvedValueOnce(null);
    const challenge = createHostedOwnershipChallenge(deploymentId, { recoveryKey: key, payment });
    const proof = TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET) as Transaction;
    proof.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
    let persisted = false;
    mocks.prepare.mockImplementation(async () => {
      persisted = true;
      return preparation(payment).prepared;
    });
    mocks.state.mockImplementation(async () => {
      expect(persisted).toBe(true);
      throw new AppError("UPSTREAM_RPC", "Current configuration could not be verified");
    });
    await expect(
      prepareHostedPayment(deployment, {
        recoveryKey: key,
        payment,
        ownershipProofXdr: proof.toXDR(),
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const original = {
      id: row.id,
      txHash: row.txHash,
      requestDigest: row.requestDigest,
      idempotencyKeyHash: row.idempotencyKeyHash,
    };
    deployment.hostedExecutionEnabled = false;
    expect(await readHostedReceipt(deploymentId, key)).toMatchObject(original);
    // Only authoritative reconciliation supplies the terminal result, never age or 502.
    mocks.reconcile.mockImplementation(async (id) => {
      expect(id).toBe(original.id);
      return { ...row, state: "EXPIRED" };
    });
    await expect(reconcileHostedPayment(deployment, key)).resolves.toMatchObject({
      intent: original.id,
      txHash: original.txHash,
      state: "EXPIRED",
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.db.walletControlIntent.updateMany).not.toHaveBeenCalled();
    expect(row).toMatchObject(original);
    await expect(readHostedReceipt(deploymentId, "cd".repeat(32))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("requires matching receipt for submit, omits fake API credentials and limits response", async () => {
    const input = { recoveryKey: key, intent: intentId, signedXdr: "signedfixture" };
    const result = await submitHostedPayment(deployment, input, "127.0.0.1");
    expect(result).toEqual({ txHash: row.txHash, status: "UNKNOWN" });
    expect(mocks.submit.mock.calls[0]?.[0]).not.toHaveProperty("tokenId");
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({ wait: false, intent: intentId });
    const admission = mocks.submit.mock.calls[0]?.[0].assertAdmission;
    deployment.hostedExecutionEnabled = false;
    await expect(admission(mocks.db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      submitHostedPayment(deployment, { ...input, intent: deploymentId }, "ip"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("opt-out closes first sends but keeps original admitted receipt reconciliation", async () => {
    deployment.hostedExecutionEnabled = false;
    await expect(
      submitHostedPayment(
        deployment,
        { recoveryKey: key, intent: intentId, signedXdr: "signedfixture" },
        "ip",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    deployment.serviceState = "RETIRING";
    const result = await reconcileHostedPayment(deployment, key);
    expect(result.state).toBe("PREPARED");
    expect(mocks.work).toHaveBeenCalledWith(
      deploymentId,
      "hosted-execution:reconcile",
      expect.any(Function),
      true,
    );
    expect(result).not.toHaveProperty("hostedAccessHash");
  });
  it("never frees unknown finality by age, or resends during reconciliation", async () => {
    row.state = "SUBMITTING";
    row.maxTime = "1";
    const result = await reconcileHostedPayment(deployment, key);
    expect(result.state).toBe("SUBMITTING");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.db.walletControlIntent.updateMany).not.toHaveBeenCalled();
  });
  it("reads retained terminal receipts without new retired service work", async () => {
    deployment.serviceState = "RETIRED";
    row.state = "SUCCESS";
    expect((await reconcileHostedPayment(deployment, key)).state).toBe("SUCCESS");
    expect(mocks.work).not.toHaveBeenCalled();
  });
});

describe("owner opt-in", () => {
  it("checks current capabilities and records toggle plus audit in one transaction", async () => {
    expect(await setHostedVisibility(deployment, "owner", true, "ip")).toEqual({ enabled: true });
    expect(mocks.state).toHaveBeenCalledWith(deployment);
    expect(mocks.db.deployment.update).toHaveBeenCalledWith({
      where: { id: deploymentId },
      data: { hostedExecutionEnabled: true },
    });
    expect(mocks.db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      userId: "owner",
      action: "HOSTED_EXECUTION_VISIBILITY",
      metadata: { deploymentId, enabled: true },
    });
  });
  it("refuses cross-owner management or unavailable capability without writing", async () => {
    await expect(setHostedVisibility(deployment, "other", true, "ip")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    mocks.state.mockResolvedValue({ supported: false });
    await expect(setHostedVisibility(deployment, "owner", true, "ip")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mocks.db.deployment.update).not.toHaveBeenCalled();
  });
  it("can disable a form even if RPC discovery is unavailable, but cannot toggle retirement", async () => {
    mocks.state.mockRejectedValue(new Error("RPC down"));
    await expect(setHostedVisibility(deployment, "owner", false, "ip")).resolves.toEqual({
      enabled: false,
    });
    expect(mocks.state).not.toHaveBeenCalled();
    mocks.lock.mockResolvedValue({ serviceState: "RETIRING" });
    await expect(setHostedVisibility(deployment, "owner", false, "ip")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
