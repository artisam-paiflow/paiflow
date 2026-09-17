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
    await db.signedTransaction.deleteMany({ where: { txHash: { in: hashes.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  beforeEach(() => {
    mockCapture.mockClear();
  });

  it("captures transaction_signed for the signer's user, or for the wallet with no profile", async () => {
    const anon = signedEnvelope();
    hashes.push(anon.signer.txHash);
    await recordSignedTransaction({ signer: anon.signer, kind: "TRIGGER", network: "testnet" });
    expect(mockCapture).toHaveBeenLastCalledWith(
      `wallet:${anon.kp.publicKey()}`,
      "transaction_signed",
      {
        deployment_id: null,
        tx_hash: anon.signer.txHash,
        signer_address: anon.kp.publicKey(),
        kind: "trigger",
        signed_by_source: true,
      },
      { personProfile: false },
    );

    const user = await db.user.create({
      data: { username: `signer-${Date.now()}-b`, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });
    userIds.push(user.id);
    const known = signedEnvelope();
    hashes.push(known.signer.txHash);
    await recordSignedTransaction({
      signer: known.signer,
      kind: "DEPLOY",
      network: "testnet",
      userId: user.id,
    });
    expect(mockCapture).toHaveBeenLastCalledWith(
      user.id,
      "transaction_signed",
      expect.objectContaining({ kind: "deploy", signer_address: known.kp.publicKey() }),
    );
  });

  it("does not capture when the row was not written", async () => {
    const { signer } = signedEnvelope();
    hashes.push(signer.txHash);
    await recordSignedTransaction({
      signer,
      kind: "DEPLOY",
      network: "testnet",
      userId: "00000000-0000-0000-0000-000000000001",
    });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("writes one row keyed on the hash; a resubmission is a no-op", async () => {
    const { kp, signer } = signedEnvelope();
    hashes.push(signer.txHash);
    const input = {
      signer,
      kind: "TRIGGER" as const,
      network: "testnet",
      userId: null,
      deploymentId: null,
      ip: "203.0.113.9",
    };

    await recordSignedTransaction(input);
    await recordSignedTransaction({ ...input, ip: "198.51.100.1" });

    const rows = await db.signedTransaction.findMany({ where: { txHash: signer.txHash } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      signerAddress: kp.publicKey(),
      feeSourceAddress: null,
      muxedSource: null,
      isFeeBump: false,
      signedBySource: true,
      userId: null,
      deploymentId: null,
      kind: "TRIGGER",
      network: "testnet",
      ip: "203.0.113.9",
    });
  });

  it("writes nothing and does not throw for an unreadable envelope", async () => {
    const signer = signerFromSignedXdr("SIGNED:AAAA", Networks.TESTNET);
    expect(signer.ok).toBe(false);
    const input = { signer, kind: "INVOKE" as const, network: "testnet" };
    expect(signedTransactionRow(input)).toBeNull();
    await expect(recordSignedTransaction(input)).resolves.toBeUndefined();
  });

  it("swallows a failed write instead of failing the caller", async () => {
    const { signer } = signedEnvelope();
    hashes.push(signer.txHash);
    // A user id that exists nowhere violates the foreign key.
    await expect(
      recordSignedTransaction({
        signer,
        kind: "DEPLOY",
        network: "testnet",
        userId: "00000000-0000-0000-0000-000000000001",
      }),
    ).resolves.toBeUndefined();
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
