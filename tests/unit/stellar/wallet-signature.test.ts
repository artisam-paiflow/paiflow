import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { assertSignedWalletTransaction, assertWalletNetwork } from "@/lib/stellar/wallet-signature";

const wallet = Keypair.random();
const other = Keypair.random();
function build(amount = "0.1") {
  return new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount }),
    )
    .setTimeout(180)
    .build();
}
function check(original: string, signed: string) {
  assertSignedWalletTransaction(original, signed, wallet.publicKey(), Networks.TESTNET);
}
describe("wallet returned envelope binding", () => {
  it("accepts unchanged body with the expected signature", () => {
    const tx = build();
    const original = tx.toXDR();
    tx.sign(wallet);
    expect(() => check(original, tx.toXDR())).not.toThrow();
  });
  it("preserves duplicate existing signatures", () => {
    const tx = build();
    tx.sign(other);
    tx.sign(other);
    const original = tx.toXDR();
    tx.sign(wallet);
    expect(() => check(original, tx.toXDR())).not.toThrow();
    tx.signatures.splice(0, 1);
    expect(() => check(original, tx.toXDR())).toThrow(/removed/);
  });
  it("rejects changed body, absent/wrong signer, wrong passphrase and fee bump", () => {
    const tx = build();
    const original = tx.toXDR();
    expect(() => check(original, tx.toXDR())).toThrow(/did not sign/);
    tx.sign(other);
    expect(() => check(original, tx.toXDR())).toThrow(/did not sign/);
    const changed = build("0.2");
    changed.sign(wallet);
    expect(() => check(original, changed.toXDR())).toThrow(/changed/);
    const wrong = TransactionBuilder.fromXDR(original, Networks.PUBLIC);
    wrong.sign(wallet);
    expect(() => check(original, wrong.toXDR())).toThrow(/did not sign/);
    const signed = build();
    signed.sign(wallet);
    const bump: FeeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      other,
      "100",
      signed,
      Networks.TESTNET,
    );
    expect(() => check(original, bump.toXDR())).toThrow(/unsupported/);
  });
  it("validates rather than replaces the server passphrase", () => {
    expect(() => assertWalletNetwork("testnet", Networks.TESTNET)).not.toThrow();
    expect(() => assertWalletNetwork("mainnet", Networks.PUBLIC)).not.toThrow();
    expect(() => assertWalletNetwork("testnet", Networks.PUBLIC)).toThrow(/networks/);
    expect(() => assertWalletNetwork("mainnet", Networks.TESTNET)).toThrow(/networks/);
  });
});
