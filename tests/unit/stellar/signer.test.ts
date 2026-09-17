import { describe, expect, it } from "vitest";
import {
  Account,
  BASE_FEE,
  Keypair,
  MuxedAccount,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { signerFromSignedXdr, signerFromTransaction } from "@/lib/stellar/signer";

const PASSPHRASE = Networks.TESTNET;

function buildTx(source: Account | MuxedAccount) {
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(30)
    .build();
}

function ok<T extends { ok: boolean }>(info: T): Extract<T, { ok: true }> {
  if (!info.ok) throw new Error("expected ok");
  return info as Extract<T, { ok: true }>;
}

describe("signerFromSignedXdr", () => {
  it("reads the source account of a signed transaction as the signer", () => {
    const kp = Keypair.random();
    const tx = buildTx(new Account(kp.publicKey(), "0"));
    tx.sign(kp);

    const info = ok(signerFromSignedXdr(tx.toXDR(), PASSPHRASE));
    expect(info.signerAddress).toBe(kp.publicKey());
    expect(info.feeSourceAddress).toBe(kp.publicKey());
    expect(info.isFeeBump).toBe(false);
    expect(info.muxedSource).toBeNull();
    expect(info.signatureCount).toBe(1);
    expect(info.signedBySource).toBe(true);
    expect(info.txHash).toBe(tx.hash().toString("hex"));
  });

  it("reports signedBySource false when a different key signed", () => {
    const source = Keypair.random();
    const other = Keypair.random();
    const tx = buildTx(new Account(source.publicKey(), "0"));
    tx.sign(other);

    const info = ok(signerFromSignedXdr(tx.toXDR(), PASSPHRASE));
    expect(info.signerAddress).toBe(source.publicKey());
    expect(info.signatureCount).toBe(1);
    expect(info.signedBySource).toBe(false);
  });

  it("tolerates an unsigned envelope", () => {
    const kp = Keypair.random();
    const tx = buildTx(new Account(kp.publicKey(), "0"));

    const info = ok(signerFromSignedXdr(tx.toXDR(), PASSPHRASE));
    expect(info.signerAddress).toBe(kp.publicKey());
    expect(info.signatureCount).toBe(0);
    expect(info.signedBySource).toBe(false);
  });

  it("uses the inner source of a fee bump as the signer and keeps the fee account", () => {
    const signer = Keypair.random();
    const payer = Keypair.random();
    const inner = buildTx(new Account(signer.publicKey(), "0"));
    inner.sign(signer);
    const bump = TransactionBuilder.buildFeeBumpTransaction(payer, "200", inner, PASSPHRASE);
    bump.sign(payer);

    const info = ok(signerFromSignedXdr(bump.toXDR(), PASSPHRASE));
    expect(info.isFeeBump).toBe(true);
    expect(info.signerAddress).toBe(signer.publicKey());
    expect(info.feeSourceAddress).toBe(payer.publicKey());
    expect(info.signatureCount).toBe(1);
    expect(info.signedBySource).toBe(true);
    expect(info.txHash).toBe(bump.hash().toString("hex"));
  });

  it("normalises a muxed source to its base account and keeps the M address", () => {
    const kp = Keypair.random();
    const muxed = new MuxedAccount(new Account(kp.publicKey(), "0"), "7");
    const tx = buildTx(muxed);
    tx.sign(kp);

    const info = ok(signerFromSignedXdr(tx.toXDR(), PASSPHRASE));
    expect(info.signerAddress).toBe(kp.publicKey());
    expect(info.muxedSource).toBe(muxed.accountId());
    expect(info.muxedSource?.startsWith("M")).toBe(true);
    expect(info.signedBySource).toBe(true);
  });

  it("returns ok: false and never throws on garbage", () => {
    const kp = Keypair.random();
    const real = buildTx(new Account(kp.publicKey(), "0")).toXDR();
    for (const junk of [`SIGNED:${real}`, "", "not-xdr", "AAAA", real.slice(0, 20)]) {
      expect(() => signerFromSignedXdr(junk, PASSPHRASE)).not.toThrow();
      expect(signerFromSignedXdr(junk, PASSPHRASE)).toEqual({ ok: false, reason: "unparseable" });
    }
  });

  it("parses under the wrong passphrase without throwing, with a different hash", () => {
    const kp = Keypair.random();
    const tx = buildTx(new Account(kp.publicKey(), "0"));
    tx.sign(kp);

    const right = ok(signerFromSignedXdr(tx.toXDR(), PASSPHRASE));
    const wrong = ok(signerFromSignedXdr(tx.toXDR(), Networks.PUBLIC));
    expect(wrong.signerAddress).toBe(right.signerAddress);
    expect(wrong.txHash).not.toBe(right.txHash);
  });
});

describe("signerFromTransaction", () => {
  it("accepts an already-parsed transaction", () => {
    const kp = Keypair.random();
    const tx = buildTx(new Account(kp.publicKey(), "0"));
    tx.sign(kp);
    const info = ok(signerFromTransaction(tx));
    expect(info.signerAddress).toBe(kp.publicKey());
    expect(info.txHash).toBe(tx.hash().toString("hex"));
  });
});
