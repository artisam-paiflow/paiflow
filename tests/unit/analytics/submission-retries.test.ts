import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { signerFromTransaction } from "@/lib/stellar/signer";
import { submitPreparedDeposit } from "@/lib/stellar/submit-deposit";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { reconcileTransactions } from "@/lib/stellar/reconcile-transactions";

const { server } = vi.hoisted(() => ({
  server: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => server }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), wasTxConfirmedFor: vi.fn() }));
vi.mock("@/lib/api/v1/execute", () => ({
  explainFailedTx: vi.fn(async () => ({ code: "test" })),
  ingestEventsBounded: vi.fn(),
  waitForFinal: vi.fn(),
}));
vi.mock("@/lib/deployments/confirm", () => ({ confirmDeployment: vi.fn() }));

const ownerIds: string[] = [],
  flowIds: string[] = [],
  deploymentIds: string[] = [],
  distinctIds: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  server.getTransaction.mockReset();
  server.sendTransaction.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: deploymentIds } } });
  await db.analyticsDelivery.deleteMany({ where: { distinctId: { in: distinctIds.splice(0) } } });
  await db.deployment.deleteMany({ where: { id: { in: deploymentIds.splice(0) } } });
  await db.flow.deleteMany({ where: { id: { in: flowIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: ownerIds.splice(0) } } });
});
async function fixture(kind: "DEPLOY" | "TRIGGER" | "API_EXECUTE") {
  const owner = await db.user.create({
    data: {
      username: `retry-${randomUUID()}`,
      passwordHash: "test-only",
      analyticsAudience: "EXTERNAL",
    },
  });
  ownerIds.push(owner.id);
  distinctIds.push(owner.id);
  const flow = await db.flow.create({
    data: {
      ownerId: owner.id,
      name: "Synthetic retry",
      templateKind: "SPLITTER",
      graph: {},
      parameters: {},
    },
  });
  flowIds.push(flow.id);
  const deployment = await db.deployment.create({
    data: {
      ownerId: owner.id,
      flowId: flow.id,
      network: "testnet",
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  });
  deploymentIds.push(deployment.id);
  const token = await db.deploymentApiToken.create({
    data: { deploymentId: deployment.id, tokenHash: randomUUID(), tokenPrefix: "test-only" },
  });
  distinctIds.push(`api:${token.id}`);
  const key = Keypair.random();
  const tx = new TransactionBuilder(new Account(key.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(180)
    .build();
  tx.sign(key);
  const signer = signerFromTransaction(tx);
  if (!signer.ok) throw new Error("Invalid synthetic envelope");
  await recordSignedTransaction({
    signer,
    kind,
    network: "testnet",
    deploymentId: deployment.id,
    userId: kind === "API_EXECUTE" ? null : owner.id,
    ...(kind === "API_EXECUTE" ? { apiTokenId: token.id } : {}),
  });
  const partnerInput = {
    tx,
    wait: false,
    tokenId: token.id,
    deploymentId: deployment.id,
    deployment,
    nodes: [],
    ip: "203.0.113.9",
  };
  return {
    txHash: signer.txHash,
    partnerInput,
    signedXdr: tx.toXDR(),
    row: () => db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
  };
}

describe("tracked RPC retry paths", () => {
  it.each(["TRY_AGAIN_LATER", "ERROR"] as const)(
    "partner preflight failure can recover through %s then queued acceptance",
    async (refusal) => {
      const f = await fixture("API_EXECUTE");
      server.getTransaction.mockRejectedValueOnce(new Error("Synthetic preflight failure"));
      await expect(submitPreparedDeposit(f.partnerInput)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(server.sendTransaction).not.toHaveBeenCalled();
      expect(await f.row()).toMatchObject({
        outcome: "UNRESOLVED",
        failureCode: "RPC_UNAVAILABLE",
        submissionRevision: 0,
      });
      server.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      server.sendTransaction.mockResolvedValueOnce({ status: refusal, hash: f.txHash });
      const refused = submitPreparedDeposit(f.partnerInput);
      if (refusal === "ERROR") await expect(refused).resolves.toMatchObject({ status: "FAILED" });
      else await expect(refused).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(await f.row()).toMatchObject({
        outcome: "REJECTED",
        failureCode: "RPC_REJECTED",
        submissionRevision: 1,
      });
      server.sendTransaction.mockRejectedValueOnce(new Error("Synthetic send ambiguity"));
      await expect(submitPreparedDeposit(f.partnerInput)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
      expect(await f.row()).toMatchObject({
        outcome: "UNRESOLVED",
        failureCode: "RPC_UNAVAILABLE",
        submissionRevision: 2,
      });
      server.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: f.txHash });
      await expect(submitPreparedDeposit(f.partnerInput)).resolves.toMatchObject({
        status: "PENDING",
      });
      expect(await f.row()).toMatchObject({
        outcome: "ACCEPTED",
        acceptedAt: expect.any(Date),
        failureCode: null,
        submissionRevision: 3,
      });
    },
  );
  it.each(["DEPLOY", "TRIGGER"] as const)(
    "%s records actual retry refusals and duplicate acceptance",
    async (kind) => {
      const f = await fixture(kind);
      const submit = kind === "DEPLOY" ? submitDeployTx : submitTriggerTx;
      server.sendTransaction.mockRejectedValueOnce(new Error("Synthetic send ambiguity"));
      await expect(submit(f.signedXdr)).rejects.toThrow("Synthetic send ambiguity");
      expect(await f.row()).toMatchObject({ outcome: "UNRESOLVED", submissionRevision: 1 });
      server.sendTransaction.mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: f.txHash });
      if (kind === "DEPLOY")
        await expect(submit(f.signedXdr)).resolves.toEqual({ status: "NOT_ACCEPTED" });
      else await expect(submit(f.signedXdr)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect(await f.row()).toMatchObject({
        outcome: "REJECTED",
        failureCode: "RPC_REJECTED",
        submissionRevision: 2,
      });
      server.sendTransaction.mockRejectedValueOnce(new Error("Synthetic send ambiguity"));
      await expect(submit(f.signedXdr)).rejects.toThrow();
      server.sendTransaction.mockResolvedValueOnce({ status: "ERROR", hash: f.txHash });
      await expect(submit(f.signedXdr)).resolves.toMatchObject({ status: "FAILED" });
      expect(await f.row()).toMatchObject({
        outcome: "REJECTED",
        failureCode: "RPC_REJECTED",
        submissionRevision: 4,
      });
      server.sendTransaction.mockResolvedValueOnce({ status: "DUPLICATE", hash: f.txHash });
      server.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 123 });
      await submit(f.signedXdr);
      expect(await f.row()).toMatchObject({
        outcome: "ACCEPTED",
        acceptedAt: expect.any(Date),
        failureCode: null,
        submissionRevision: 5,
      });
    },
  );
  it.each(["DEPLOY", "TRIGGER", "API_EXECUTE"] as const)(
    "%s stops before sending if attempt reservation fails",
    async (kind) => {
      const f = await fixture(kind);
      server.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      vi.spyOn(db.signedTransaction, "update").mockRejectedValueOnce(
        new Error("Synthetic reservation failure"),
      );
      const pending =
        kind === "API_EXECUTE"
          ? submitPreparedDeposit(f.partnerInput)
          : kind === "DEPLOY"
            ? submitDeployTx(f.signedXdr)
            : submitTriggerTx(f.signedXdr);
      await expect(pending).rejects.toThrow("Synthetic reservation failure");
      expect(server.sendTransaction).not.toHaveBeenCalled();
      expect(await f.row()).toMatchObject({ outcome: "RECEIVED", submissionRevision: 0 });
    },
  );
  it("a stale reconciliation NOT_FOUND cannot undo a retry's acceptance", async () => {
    const f = await fixture("TRIGGER");
    await db.signedTransaction.update({
      where: { txHash: f.txHash },
      data: { nextCheckAt: new Date(0) },
    });
    let resolveRead!: (value: { status: string }) => void;
    let signalRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    server.getTransaction.mockImplementationOnce(() => {
      signalRead();
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    });
    const reconciliation = reconcileTransactions({ batch: 1 });
    await readStarted;
    server.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: f.txHash });
    await submitTriggerTx(f.signedXdr);
    const accepted = await f.row();
    resolveRead({ status: "NOT_FOUND" });
    await reconciliation;
    expect(await f.row()).toMatchObject({
      outcome: "ACCEPTED",
      outcomeRevision: accepted.outcomeRevision,
      nextCheckAt: accepted.nextCheckAt,
      failureCode: null,
    });
  });
  it("late queued acceptance survives a newer actual rejection", async () => {
    const f = await fixture("TRIGGER");
    let resolveSend!: (value: { status: string; hash: string }) => void;
    let signalSend!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      signalSend = resolve;
    });
    server.sendTransaction.mockImplementationOnce(() => {
      signalSend();
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    });
    const first = submitTriggerTx(f.signedXdr);
    await sendStarted;
    server.sendTransaction.mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: f.txHash });
    await expect(submitTriggerTx(f.signedXdr)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(await f.row()).toMatchObject({ outcome: "REJECTED" });
    resolveSend({ status: "PENDING", hash: f.txHash });
    await first;
    expect(await f.row()).toMatchObject({
      outcome: "ACCEPTED",
      acceptedAt: expect.any(Date),
      submissionRevision: 2,
      failureCode: null,
    });
  });
});
