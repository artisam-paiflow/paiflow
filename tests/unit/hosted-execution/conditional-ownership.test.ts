import { createHash } from "node:crypto";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  Memo,
  xdr,
} from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConditionalHostedOwnershipChallenge,
  verifyConditionalHostedOwnershipProof,
  conditionalHostedOwnershipDigest,
} from "@/lib/stellar/conditional-hosted-ownership";
import { conditionalHostedOwnershipBinding } from "@/lib/hosted-execution/conditional-ownership-binding";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import {
  createHostedOwnershipChallenge,
  verifyHostedOwnershipProof,
} from "@/lib/stellar/hosted-ownership";
import { payment as oldPayment, deploymentId, bob } from "./fixtures";
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const payment = {
  amount: "1000",
  from: signer.publicKey(),
  arguments: { version: 2 as const, inputs: [] },
};
const input = { recoveryKey: "ab".repeat(32), payment };
function original() {
  const challenge = createConditionalHostedOwnershipChallenge(deploymentId, input);
  return TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET) as Transaction;
}
function signed(tx: Transaction, key = signer) {
  tx.sign(key);
  return tx.toXDR();
}
afterEach(() => vi.restoreAllMocks());
describe("conditional sign-only ownership", () => {
  it("matches WebCrypto binding, canonical UUID/object order and distinct lifecycle digest", async () => {
    const digest = conditionalHostedOwnershipDigest(deploymentId, input);
    expect(digest).toBe(
      await conditionalHostedOwnershipBinding(
        deploymentId.toUpperCase(),
        input,
        "testnet",
        Networks.TESTNET,
      ),
    );
    expect(
      conditionalHostedOwnershipDigest(deploymentId, {
        payment: { arguments: payment.arguments, from: payment.from, amount: payment.amount },
        recoveryKey: input.recoveryKey,
      }),
    ).toBe(digest);
    expect(digest).not.toBe(
      executionRequestDigest({ version: 2, deploymentId, network: "testnet", input: payment }),
    );
    const tx = original();
    expect(tx.sequence).toBe("0");
    expect(tx.fee).toBe("100");
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({
      type: "manageData",
      name: "paiflow.hosted-ownership.v2",
    });
    expect(() =>
      verifyConditionalHostedOwnershipProof(deploymentId, input, signed(tx)),
    ).not.toThrow();
  });
  it.each([undefined, "not-xdr", "a".repeat(4097)])(
    "refuses missing/malformed proof with fixed ownership requirement",
    (proof) => {
      expect(() => verifyConditionalHostedOwnershipProof(deploymentId, input, proof)).toThrow(
        /Verify ownership/,
      );
      try {
        verifyConditionalHostedOwnershipProof(deploymentId, input, proof);
      } catch (error) {
        expect(error).toMatchObject({
          code: "VALIDATION",
          fields: { ownershipProofXdr: ["A current wallet ownership signature is required"] },
        });
      }
    },
  );
  it("binds every request/key/source/deployment and ordered input", () => {
    const proof = signed(original());
    for (const other of [
      { ...input, recoveryKey: "cd".repeat(32) },
      { ...input, payment: { ...payment, amount: "1001" } },
      { ...input, payment: { ...payment, from: bob } },
      {
        ...input,
        payment: {
          ...payment,
          arguments: {
            version: 2 as const,
            inputs: [{ kind: "pay" as const, nodeId: "node", recipient: bob }],
          },
        },
      },
    ])
      expect(() => verifyConditionalHostedOwnershipProof(deploymentId, other, proof)).toThrow();
    expect(() =>
      verifyConditionalHostedOwnershipProof("22222222-2222-4222-8222-222222222222", input, proof),
    ).toThrow();
    const multiple = {
      ...input,
      payment: {
        ...payment,
        arguments: {
          version: 2 as const,
          inputs: [
            { kind: "pay" as const, nodeId: "first", recipient: bob },
            { kind: "pay" as const, nodeId: "second", recipient: payment.from },
          ],
        },
      },
    };
    const c = createConditionalHostedOwnershipChallenge(deploymentId, multiple),
      p = signed(TransactionBuilder.fromXDR(c.xdr, Networks.TESTNET) as Transaction);
    expect(() => verifyConditionalHostedOwnershipProof(deploymentId, multiple, p)).not.toThrow();
    expect(() =>
      verifyConditionalHostedOwnershipProof(
        deploymentId,
        {
          ...multiple,
          payment: {
            ...multiple.payment,
            arguments: { version: 2, inputs: [...multiple.payment.arguments.inputs].reverse() },
          },
        },
        p,
      ),
    ).toThrow();
  });
  it("rejects generation crossover and wrong network/signature/hint/count", () => {
    const old = createHostedOwnershipChallenge(deploymentId, {
      recoveryKey: input.recoveryKey,
      payment: oldPayment,
    });
    expect(() =>
      verifyConditionalHostedOwnershipProof(
        deploymentId,
        input,
        signed(TransactionBuilder.fromXDR(old.xdr, Networks.TESTNET) as Transaction),
      ),
    ).toThrow();
    expect(() =>
      verifyHostedOwnershipProof(
        deploymentId,
        { recoveryKey: input.recoveryKey, payment: oldPayment },
        signed(original()),
      ),
    ).toThrow();
    expect(() =>
      verifyConditionalHostedOwnershipProof(deploymentId, input, original().toXDR()),
    ).toThrow();
    expect(() =>
      verifyConditionalHostedOwnershipProof(
        deploymentId,
        input,
        signed(original(), Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9))),
      ),
    ).toThrow();
    const other = new Transaction(original().toEnvelope(), Networks.PUBLIC);
    expect(() =>
      verifyConditionalHostedOwnershipProof(deploymentId, input, signed(other)),
    ).toThrow();
    const dup = original();
    dup.sign(signer);
    dup.sign(signer);
    expect(() => verifyConditionalHostedOwnershipProof(deploymentId, input, dup.toXDR())).toThrow();
    const hint = original();
    hint.sign(signer);
    hint.signatures[0]!.hint(Buffer.alloc(4));
    expect(() =>
      verifyConditionalHostedOwnershipProof(deploymentId, input, hint.toXDR()),
    ).toThrow();
  });
  it("rejects altered body, fee, source, memo, sequence, op, preconditions, v0 and feebump", () => {
    const tx = original(),
      min = Number(tx.timeBounds!.minTime),
      max = Number(tx.timeBounds!.maxTime),
      op = tx.operations[0]!;
    if (op.type !== "manageData") throw new Error();
    const build = (change: {
      fee?: string;
      sequence?: string;
      source?: string;
      memo?: boolean;
      extra?: boolean;
      name?: string;
      value?: string;
      operationSource?: string;
      minTime?: number;
      maxTime?: number;
      extraSigner?: boolean;
      ledger?: boolean;
    }) => {
      const b = new TransactionBuilder(
        new Account(change.source ?? payment.from, change.sequence ?? "-1"),
        {
          fee: change.fee ?? "100",
          networkPassphrase: Networks.TESTNET,
          timebounds: { minTime: change.minTime ?? min, maxTime: change.maxTime ?? max },
          ...(change.memo ? { memo: Memo.text("changed") } : {}),
          ...(change.extraSigner ? { extraSigners: [bob] } : {}),
          ...(change.ledger ? { ledgerbounds: { minLedger: 1, maxLedger: 2 } } : {}),
        },
      ).addOperation(
        Operation.manageData({
          name: change.name ?? op.name,
          value: change.value ?? op.value!,
          ...(change.operationSource ? { source: change.operationSource } : {}),
        }),
      );
      if (change.extra) b.addOperation(Operation.manageData({ name: "extra", value: "extra" }));
      return b.build();
    };
    for (const change of [
      { fee: "101" },
      { sequence: "0" },
      { source: bob },
      { memo: true },
      { extra: true },
      { name: "wrong" },
      { value: "wrong" },
      { operationSource: payment.from },
      { minTime: min - 1 },
      { maxTime: 0 },
      { maxTime: max + 1 },
      { extraSigner: true },
      { ledger: true },
    ])
      expect(() =>
        verifyConditionalHostedOwnershipProof(deploymentId, input, signed(build(change))),
      ).toThrow();
    const bump = TransactionBuilder.buildFeeBumpTransaction(signer, "100", tx, Networks.TESTNET);
    bump.sign(signer);
    expect(() =>
      verifyConditionalHostedOwnershipProof(deploymentId, input, bump.toXDR()),
    ).toThrow();
    const body = tx.toEnvelope().v1().tx();
    const v0 = new Transaction(
      xdr.TransactionEnvelope.envelopeTypeTxV0(
        new xdr.TransactionV0Envelope({
          tx: new xdr.TransactionV0({
            sourceAccountEd25519: signer.rawPublicKey(),
            fee: body.fee(),
            seqNum: body.seqNum(),
            timeBounds: body.cond().timeBounds(),
            memo: body.memo(),
            operations: body.operations(),
            ext: new xdr.TransactionV0Ext(0),
          }),
          signatures: [],
        }),
      ),
      Networks.TESTNET,
    );
    expect(v0.hash().equals(tx.hash())).toBe(true);
    expect(() => verifyConditionalHostedOwnershipProof(deploymentId, input, signed(v0))).toThrow();
  });
  it("rejects expiry/future issuance without returning proof bytes", () => {
    const tx = original(),
      proof = signed(tx),
      min = Number(tx.timeBounds!.minTime),
      max = Number(tx.timeBounds!.maxTime);
    vi.spyOn(Date, "now").mockReturnValue((min - 1) * 1000);
    expect(() => verifyConditionalHostedOwnershipProof(deploymentId, input, proof)).toThrow();
    vi.spyOn(Date, "now").mockReturnValue(max * 1000);
    expect(() => verifyConditionalHostedOwnershipProof(deploymentId, input, proof)).toThrow();
    expect(createHash("sha256").update(proof).digest("hex")).toHaveLength(64);
  });
});
