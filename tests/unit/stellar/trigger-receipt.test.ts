import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createTriggerReceipt, readTriggerReceipt } from "@/lib/stellar/trigger-receipt";
const kp = Keypair.random();
function transaction(timeout = 180) {
  return new TransactionBuilder(new Account(kp.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "test", value: "1" }))
    .setTimeout(timeout)
    .build();
}
describe("read-only trigger status receipt", () => {
  it("binds exact hash, deployment, network and ledger/time bounds without an envelope", () => {
    const tx = transaction();
    const prepared = createTriggerReceipt(tx.toXDR(), "deployment", 1000);
    const read = readTriggerReceipt(prepared.receipt, "deployment", prepared.txHash);
    expect(read).toEqual({
      deploymentId: "deployment",
      network: "testnet",
      txHash: tx.hash().toString("hex"),
      maxTime: tx.timeBounds!.maxTime,
      preparationLedger: 1000,
    });
    expect(prepared.receipt).not.toContain(tx.toXDR());
  });
  it("rejects altered hash, deployment, metadata and signature", () => {
    const prepared = createTriggerReceipt(transaction().toXDR(), "deployment", 1000);
    expect(() => readTriggerReceipt(prepared.receipt, "other", prepared.txHash)).toThrow();
    expect(() => readTriggerReceipt(prepared.receipt, "deployment", "a".repeat(64))).toThrow();
    const [payload, signature] = prepared.receipt.split(".");
    const state = JSON.parse(Buffer.from(payload!, "base64url").toString());
    state.preparationLedger = 1;
    const changed = Buffer.from(JSON.stringify(state)).toString("base64url");
    expect(() =>
      readTriggerReceipt(`${changed}.${signature}`, "deployment", prepared.txHash),
    ).toThrow();
    expect(() => readTriggerReceipt(`${payload}.invalid`, "deployment", prepared.txHash)).toThrow();
  });
  it("requires finite expiry and valid preparation ledger", () => {
    expect(() => createTriggerReceipt(transaction(0).toXDR(), "deployment", 1000)).toThrow();
    expect(() => createTriggerReceipt(transaction().toXDR(), "deployment", 0)).toThrow();
  });
  it("retains read-only proof after wall-clock expiration", () => {
    const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "test", value: "1" }))
      .setTimebounds(0, 100)
      .build();
    const prepared = createTriggerReceipt(tx.toXDR(), "deployment", 1000);
    expect(readTriggerReceipt(prepared.receipt, "deployment", prepared.txHash).maxTime).toBe("100");
  });
});
