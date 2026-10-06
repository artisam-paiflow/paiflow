/**
 * `SignedTransaction` is the system of record for wallet ↔ user ↔ tx hash, so
 * the upsert-on-hash idempotency, the nullable signer user, and the SetNull on
 * user deletion are asserted against the real Postgres the suite already uses
 * (see `tests/unit/setup.ts`, which preserves DATABASE_URL), not a mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn(async () => undefined) }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: mockCapture }));
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { recordSignedTransaction, signedTransactionRow } from "@/lib/signed-tx";
import { signerFromSignedXdr, type SignerInfo } from "@/lib/stellar/signer";

function signedEnvelope() {
  const kp = Keypair.random();
  const tx = new TransactionBuilder(new Account(kp.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(30)
    .build();
  tx.sign(kp);
  const signer = signerFromSignedXdr(tx.toXDR(), Networks.TESTNET);
  if (!signer.ok) throw new Error("test envelope did not parse");
  return { kp, signer: signer as Extract<SignerInfo, { ok: true }> };
}

describe("recordSignedTransaction", () => {
  const hashes: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    for (const hash of hashes)
      await db.analyticsDelivery.deleteMany({
        where: { properties: { path: ["tx_hash"], equals: hash } },
      });
    await db.signedTransaction.deleteMany({ where: { txHash: { in: hashes.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  beforeEach(() => {
    mockCapture.mockClear();
  });

  it("writes one durable signed event per hash and preserves the first attribution", async () => {
    const { kp, signer } = signedEnvelope();
    hashes.push(signer.txHash);
    const input = { signer, kind: "TRIGGER" as const, network: "testnet", ip: "203.0.113.9" };
    await recordSignedTransaction(input);
    await recordSignedTransaction({ ...input, ip: "198.51.100.1" });
    expect(await db.signedTransaction.count({ where: { txHash: signer.txHash } })).toBe(1);
    expect(
      await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      signerAddress: kp.publicKey(),
      userId: null,
      outcome: "RECEIVED",
      trackingVersion: "usage-v2",
      ip: input.ip,
    });
    expect(
      await db.analyticsDelivery.count({
        where: {
          event: "transaction_signed",
          properties: { path: ["tx_hash"], equals: signer.txHash },
        },
      }),
    ).toBe(1);
  });
  it("fails closed for an unreadable envelope", async () => {
    const input = {
      signer: signerFromSignedXdr("SIGNED:AAAA", Networks.TESTNET),
      kind: "INVOKE" as const,
      network: "testnet",
    };
    expect(signedTransactionRow(input)).toBeNull();
    await expect(recordSignedTransaction(input)).rejects.toThrow();
  });
  it("fails before submission if the durable write fails", async () => {
    const { signer } = signedEnvelope();
    hashes.push(signer.txHash);
    await expect(
      recordSignedTransaction({
        signer,
        kind: "DEPLOY",
        network: "testnet",
        userId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow();
    expect(await db.signedTransaction.count({ where: { txHash: signer.txHash } })).toBe(0);
  });

  it("links the row to the signer's user and survives that user's deletion", async () => {
    const user = await db.user.create({
      data: { username: `signer-${Date.now()}`, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });
    userIds.push(user.id);
    const { signer } = signedEnvelope();
    hashes.push(signer.txHash);

    await recordSignedTransaction({ signer, kind: "INVOKE", network: "testnet", userId: user.id });
    const before = await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } });
    expect(before?.userId).toBe(user.id);

    await db.user.delete({ where: { id: user.id } });
    userIds.splice(0);
    const after = await db.signedTransaction.findUnique({ where: { txHash: signer.txHash } });
    expect(after).not.toBeNull();
    expect(after?.userId).toBeNull();
    expect(after?.signerAddress).toBe(before?.signerAddress);
  });
});
