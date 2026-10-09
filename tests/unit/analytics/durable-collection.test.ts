import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import * as outbox from "@/lib/analytics/outbox";
import { recordWalletConnection } from "@/lib/analytics/wallet-connections";
import { recordSignedTransaction } from "@/lib/signed-tx";
import {
  beginTransactionSubmission,
  canTransition,
  recordTransactionOutcome,
  transactionObservation,
} from "@/lib/analytics/outcomes";
import { signerFromTransaction } from "@/lib/stellar/signer";
import { usageReport } from "@/lib/analytics/report";
const ids: string[] = [],
  hashes: string[] = [],
  userIds: string[] = [];
afterEach(async () => {
  await db.walletConnection.deleteMany({ where: { id: { in: ids.splice(0) } } });
  await db.signedTransaction.deleteMany({ where: { txHash: { in: hashes.splice(0) } } });
  await db.analyticsDelivery.deleteMany({ where: { distinctId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});
function envelope() {
  const kp = Keypair.random();
  const tx = new TransactionBuilder(new Account(kp.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(180)
    .build();
  tx.sign(kp);
  const signer = signerFromTransaction(tx);
  if (!signer.ok) throw new Error("Unparseable test envelope");
  hashes.push(signer.txHash);
  return signer;
}
async function account(audience: "INTERNAL" | "EXTERNAL" = "INTERNAL") {
  const user = await db.user.create({
    data: {
      username: `analytics-${randomUUID()}`,
      passwordHash: "test-only",
      analyticsAudience: audience,
    },
  });
  userIds.push(user.id);
  return user;
}
describe("durable future collection", () => {
  it("preserves RPC_REJECTED across missing finality and read errors until acceptance", async () => {
    const user = await account();
    const signer = envelope();
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    expect(
      await recordTransactionOutcome(signer.txHash, "REJECTED", { failureCode: "RPC_REJECTED" }),
    ).toBe(true);
    const rejected = await db.signedTransaction.findUniqueOrThrow({
      where: { txHash: signer.txHash },
    });
    for (const failureCode of ["FINALITY_UNKNOWN", "RPC_UNAVAILABLE"] as const)
      expect(await recordTransactionOutcome(signer.txHash, "UNRESOLVED", { failureCode })).toBe(
        false,
      );
    expect(
      await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "REJECTED",
      failureCode: "RPC_REJECTED",
      rejectedAt: rejected.rejectedAt,
    });
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: user.id, event: "transaction_outcome" },
      }),
    ).toBe(1);
    expect(await recordTransactionOutcome(signer.txHash, "ACCEPTED")).toBe(true);
    expect(
      await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
        failureCode: "FINALITY_UNKNOWN",
      }),
    ).toBe(true);
    expect(await recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 456 })).toBe(true);
  });
  it("acknowledges one connection and one business event despite concurrent retries", async () => {
    const user = await account();
    const connectionId = randomUUID();
    ids.push(connectionId);
    const input = {
      connectionId,
      address: Keypair.random().publicKey(),
      network: "testnet" as const,
      walletId: "freighter",
      surface: "trigger" as const,
      sessionUserId: user.id,
    };
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => recordWalletConnection(input, user.id)),
    );
    expect(replies.filter((r) => r.created)).toHaveLength(1);
    expect(await db.walletConnection.count({ where: { id: connectionId } })).toBe(1);
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: user.id, event: "wallet_connect_succeeded" },
      }),
    ).toBe(1);
    expect(await db.walletConnection.findUnique({ where: { id: connectionId } })).toMatchObject({
      audience: "INTERNAL",
      trackingVersion: "usage-v2",
    });
    await expect(
      recordWalletConnection({ ...input, walletId: "albedo" }, user.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      recordWalletConnection(
        { ...input, connectionId: randomUUID(), sessionUserId: null },
        user.id,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rolls back acknowledgement if the transactional business event cannot be saved", async () => {
    const user = await account();
    const id = randomUUID();
    ids.push(id);
    const create = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      recordWalletConnection(
        {
          connectionId: id,
          address: Keypair.random().publicKey(),
          network: "testnet",
          walletId: "freighter",
          surface: "trigger",
          sessionUserId: user.id,
        },
        user.id,
      ),
    ).rejects.toThrow("database unavailable");
    create.mockRestore();
    expect(await db.walletConnection.count({ where: { id } })).toBe(0);
  });
  it("tracks received, unresolved and confirmed without stale regressions or duplicate events", async () => {
    const user = await account();
    const signer = envelope();
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: user.id, event: "transaction_signed" },
      }),
    ).toBe(1);
    await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
      failureCode: "FINALITY_UNKNOWN",
    });
    const changed = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 123 }),
      ),
    );
    expect(changed.filter(Boolean)).toHaveLength(1);
    expect(
      await recordTransactionOutcome(signer.txHash, "FAILED", { failureCode: "ONCHAIN_FAILED" }),
    ).toBe(false);
    expect(await recordTransactionOutcome(signer.txHash, "ACCEPTED")).toBe(false);
    expect(
      await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "CONFIRMED",
      ledger: 123,
      failureCode: null,
      nextCheckAt: null,
      audience: "INTERNAL",
    });
    expect(
      await db.analyticsDelivery.count({
        where: { distinctId: user.id, event: "transaction_outcome" },
      }),
    ).toBe(2);
  });
  it("stops a submission before the RPC call when its durable row cannot be written", async () => {
    const signer = envelope();
    await expect(
      recordSignedTransaction({
        signer,
        kind: "TRIGGER",
        network: "testnet",
        userId: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await db.signedTransaction.count({ where: { txHash: signer.txHash } })).toBe(0);
  });
  it("does not alter historical rows or attribute a mismatched deployment hash", async () => {
    const user = await account();
    const signer = envelope();
    await db.signedTransaction.create({
      data: {
        txHash: signer.txHash,
        signerAddress: signer.signerAddress,
        kind: "TRIGGER",
        network: "testnet",
        userId: user.id,
      },
    });
    expect(await recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 123 })).toBe(false);
    expect(
      await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } }),
    ).toMatchObject({ outcome: null, trackingVersion: null });
    const future = envelope();
    await recordSignedTransaction({
      signer: future,
      kind: "INVOKE",
      network: "testnet",
      userId: user.id,
    });
    expect(
      await recordTransactionOutcome(future.txHash, "CONFIRMED", { deploymentId: randomUUID() }),
    ).toBe(false);
  });
  it("reports connected addresses separately from confirmed transaction addresses and accounts", async () => {
    const user = await account("EXTERNAL");
    const signer = envelope();
    const connectionId = randomUUID();
    ids.push(connectionId);
    const start = new Date().toISOString();
    await recordWalletConnection(
      {
        connectionId,
        address: Keypair.random().publicKey(),
        network: "testnet",
        walletId: "freighter",
        surface: "trigger",
        sessionUserId: user.id,
      },
      user.id,
    );
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    await recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 456 });
    const report = await usageReport({
      start,
      end: new Date(Date.now() + 1000).toISOString(),
      network: "testnet",
      audience: "EXTERNAL",
    });
    expect(report.totals).toMatchObject({
      connected_addresses: "1",
      transaction_using_addresses: "1",
      meaningful_active_accounts: "1",
      successful_executions: "1",
      confirmed_deployments: "0",
    });
    await expect(
      usageReport({
        start: "2000-01-01T00:00:00Z",
        end: new Date().toISOString(),
        network: "testnet",
        audience: "EXTERNAL",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("keeps chain failures terminal and transport rejection distinguishable", () => {
    expect(canTransition("REJECTED", "ACCEPTED")).toBe(true);
    expect(canTransition("REJECTED", "UNRESOLVED")).toBe(false);
    expect(canTransition("REJECTED", "UNRESOLVED", true)).toBe(true);
    expect(canTransition("FAILED", "CONFIRMED")).toBe(false);
    expect(canTransition("ACCEPTED", "REJECTED")).toBe(false);
  });
  it("records ambiguity after an actual resend without treating a status read as a resend", async () => {
    const user = await account();
    const signer = envelope();
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    await recordTransactionOutcome(signer.txHash, "REJECTED", { failureCode: "RPC_REJECTED" });
    const submissionAttempt = await beginTransactionSubmission(signer.txHash);
    expect(
      await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
        failureCode: "RPC_UNAVAILABLE",
        submissionAttempt,
      }),
    ).toBe(true);
    expect(
      await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "UNRESOLVED",
      failureCode: "RPC_UNAVAILABLE",
    });
  });
});

describe("revisioned submission evidence", () => {
  async function tracked() {
    const user = await account();
    const signer = envelope();
    await recordSignedTransaction({ signer, kind: "TRIGGER", network: "testnet", userId: user.id });
    return { user, signer };
  }
  it("emits each retry cycle with a unique increasing outcome revision", async () => {
    const { user, signer } = await tracked();
    await recordTransactionOutcome(signer.txHash, "UNRESOLVED", { failureCode: "RPC_UNAVAILABLE" });
    const first = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "REJECTED", {
      failureCode: "RPC_REJECTED",
      submissionAttempt: first,
    });
    const second = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
      failureCode: "RPC_UNAVAILABLE",
      submissionAttempt: second,
    });
    const third = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "REJECTED", {
      failureCode: "RPC_REJECTED",
      submissionAttempt: third,
    });
    const fourth = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: fourth });
    const accepted = await db.signedTransaction.findUniqueOrThrow({
      where: { txHash: signer.txHash },
    });
    await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
      failureCode: "FINALITY_UNKNOWN",
      observation: await transactionObservation(signer.txHash),
    });
    const fifth = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: fifth });
    expect(
      await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: fifth }),
    ).toBe(false);
    const events = await db.analyticsDelivery.findMany({
      where: { distinctId: user.id, event: "transaction_outcome" },
    });
    const revisions = events
      .map((event) => event.properties as { outcome_revision: number; outcome: string })
      .sort((a, b) => a.outcome_revision - b.outcome_revision);
    expect(revisions.map((event) => event.outcome)).toEqual([
      "UNRESOLVED",
      "REJECTED",
      "UNRESOLVED",
      "REJECTED",
      "ACCEPTED",
      "UNRESOLVED",
      "ACCEPTED",
    ]);
    expect(revisions.map((event) => event.outcome_revision)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(events.map((event) => event.id)).size).toBe(7);
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "ACCEPTED",
      acceptedAt: accepted.acceptedAt,
      failureCode: null,
      outcomeRevision: 7,
    });
  });
  it("rejects older sends and pre-retry reads but preserves definitive chain finality", async () => {
    const { signer } = await tracked();
    const first = await beginTransactionSubmission(signer.txHash);
    const oldRead = await transactionObservation(signer.txHash);
    const second = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: second });
    expect(
      await recordTransactionOutcome(signer.txHash, "REJECTED", {
        submissionAttempt: first,
        failureCode: "RPC_REJECTED",
      }),
    ).toBe(false);
    expect(
      await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
        observation: oldRead,
        failureCode: "RPC_UNAVAILABLE",
      }),
    ).toBe(false);
    expect(
      await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
        submissionAttempt: first,
        failureCode: "RPC_UNAVAILABLE",
      }),
    ).toBe(false);
    expect(
      await recordTransactionOutcome(signer.txHash, "CONFIRMED", {
        ledger: 123,
        observation: oldRead,
      }),
    ).toBe(true);
    expect(
      await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
        submissionAttempt: second,
        failureCode: "RPC_UNAVAILABLE",
      }),
    ).toBe(false);
  });
  it("retains late same-hash acceptance and forbids rejection after acceptance became unresolved", async () => {
    const { signer } = await tracked();
    const first = await beginTransactionSubmission(signer.txHash);
    const second = await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "REJECTED", {
      submissionAttempt: second,
      failureCode: "RPC_REJECTED",
    });
    expect(
      await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: first }),
    ).toBe(true);
    const accepted = await db.signedTransaction.findUniqueOrThrow({
      where: { txHash: signer.txHash },
    });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    await recordTransactionOutcome(signer.txHash, "UNRESOLVED", {
      observation: await transactionObservation(signer.txHash),
      failureCode: "FINALITY_UNKNOWN",
    });
    const third = await beginTransactionSubmission(signer.txHash);
    expect(
      await recordTransactionOutcome(signer.txHash, "REJECTED", {
        submissionAttempt: third,
        failureCode: "RPC_REJECTED",
      }),
    ).toBe(false);
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "UNRESOLVED",
      acceptedAt: accepted.acceptedAt,
      failureCode: "FINALITY_UNKNOWN",
    });
  });
  it("records late acceptance evidence without reopening verified finality", async () => {
    const { signer } = await tracked();
    const first = await beginTransactionSubmission(signer.txHash);
    await beginTransactionSubmission(signer.txHash);
    await recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 123 });
    expect(
      await recordTransactionOutcome(signer.txHash, "ACCEPTED", { submissionAttempt: first }),
    ).toBe(false);
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      outcome: "CONFIRMED",
      ledger: 123,
      outcomeRevision: 1,
      acceptedAt: expect.any(Date),
    });
  });
  it("reserves unique revisions and preserves finality while concurrent sends start", async () => {
    const { signer } = await tracked();
    const revisions = await Promise.all(
      Array.from({ length: 8 }, () => beginTransactionSubmission(signer.txHash)),
    );
    expect([...revisions].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await Promise.all([
      ...Array.from({ length: 8 }, () => beginTransactionSubmission(signer.txHash)),
      recordTransactionOutcome(signer.txHash, "CONFIRMED", { ledger: 123 }),
    ]);
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({ outcome: "CONFIRMED", ledger: 123, submissionRevision: 16 });
  });
  it("does not claim historical or untracked callers when allocating submission evidence", async () => {
    const signer = envelope();
    expect(await beginTransactionSubmission(signer.txHash)).toBeUndefined();
    await db.signedTransaction.create({
      data: {
        txHash: signer.txHash,
        signerAddress: signer.signerAddress,
        network: "testnet",
        kind: "TRIGGER",
      },
    });
    expect(await beginTransactionSubmission(signer.txHash)).toBeUndefined();
    expect(await transactionObservation(signer.txHash)).toBeUndefined();
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      submissionRevision: 0,
      outcomeRevision: 0,
      trackingVersion: null,
      outcome: null,
    });
  });
});
