import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  Memo,
  FeeBumpTransaction,
  xdr,
} from "@stellar/stellar-sdk";
import {
  createHostedOwnershipChallenge,
  verifyHostedOwnershipProof,
} from "@/lib/stellar/hosted-ownership";
import { assertHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership-transaction";
import {
  HostedOwnershipChallengeSchema,
  HostedOwnershipRequestSchema,
  HostedPrepareSchema,
} from "@/lib/hosted-execution/schema";
import { deploymentId, payment, bob } from "./fixtures";

const input = { recoveryKey: "ab".repeat(32), payment };
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
function signed(tx: Transaction | FeeBumpTransaction, key = signer) {
  tx.sign(key);
  return tx.toXDR();
}
function challengeTx() {
  const challenge = createHostedOwnershipChallenge(deploymentId, input);
  return TransactionBuilder.fromXDR(challenge.xdr, challenge.networkPassphrase) as Transaction;
}
afterEach(() => vi.restoreAllMocks());
describe("stateless hosted wallet ownership", () => {
  it("refuses legacy v0 envelopes even where their normalized signing hash matches", () => {
    const original = challengeTx();
    const body = original.toEnvelope().v1().tx();
    const legacy = new Transaction(
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
    expect(legacy.hash().equals(original.hash())).toBe(true);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, signed(legacy))).toThrow();
  });
  it("issues an exact unbroadcastable sequence-zero challenge, validates shape client-side and source signature server-side", () => {
    const challenge = HostedOwnershipChallengeSchema.parse(
      createHostedOwnershipChallenge(deploymentId, input),
    );
    assertHostedOwnershipChallenge(challenge, payment.from, "testnet");
    const tx = challengeTx();
    expect(tx.sequence).toBe("0");
    expect(tx.fee).toBe("100");
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("manageData");
    expect(tx.operations[0]).toMatchObject({ name: "paiflow.hosted-ownership.v1" });
    expect(challenge.xdr).not.toContain(input.recoveryKey);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, signed(tx))).not.toThrow();
  });
  it.each([undefined, "not-xdr", "a".repeat(4097)])(
    "refuses missing/malformed proof without raw diagnostics",
    (proof) => {
      expect(() => verifyHostedOwnershipProof(deploymentId, input, proof)).toThrow(
        /Verify ownership/,
      );
    },
  );
  it("refuses unsigned, other-wallet, wrong-network, duplicate and extra signatures", () => {
    const tx = challengeTx();
    const wrongSigner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
    for (const xdr of [tx.toXDR(), signed(challengeTx(), wrongSigner)])
      expect(() => verifyHostedOwnershipProof(deploymentId, input, xdr)).toThrow();
    const wrongNetwork = new Transaction(tx.toEnvelope(), Networks.PUBLIC);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, signed(wrongNetwork))).toThrow();
    tx.sign(signer);
    tx.sign(signer);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, tx.toXDR())).toThrow();
    const badHint = challengeTx();
    badHint.sign(signer);
    badHint.signatures[0]!.hint(Buffer.alloc(4));
    expect(() => verifyHostedOwnershipProof(deploymentId, input, badHint.toXDR())).toThrow();
  });
  it("binds deployment, payer, complete payment and recovery key; canonical object order preserves arrays", () => {
    const proof = signed(challengeTx());
    expect(() =>
      verifyHostedOwnershipProof("22222222-2222-4222-8222-222222222222", input, proof),
    ).toThrow();
    for (const other of [
      { ...input, recoveryKey: "cd".repeat(32) },
      { ...input, payment: { ...payment, from: bob } },
      { ...input, payment: { ...payment, amount: "101" } },
      {
        ...input,
        payment: {
          ...payment,
          arguments: {
            version: 1 as const,
            inputs: [{ kind: "pay" as const, nodeId: "pay", recipient: bob }],
          },
        },
      },
    ])
      expect(() => verifyHostedOwnershipProof(deploymentId, other, proof)).toThrow();
    const reordered = {
      payment: { arguments: payment.arguments, amount: payment.amount, from: payment.from },
      recoveryKey: input.recoveryKey,
    };
    expect(() => verifyHostedOwnershipProof(deploymentId, reordered, proof)).not.toThrow();
    const multiple = {
      ...input,
      payment: {
        ...payment,
        arguments: {
          version: 1 as const,
          inputs: [
            { kind: "pay" as const, nodeId: "first", recipient: bob },
            { kind: "pay" as const, nodeId: "second", recipient: payment.from },
          ],
        },
      },
    };
    const challenge = createHostedOwnershipChallenge(deploymentId, multiple);
    const arrayProof = signed(
      TransactionBuilder.fromXDR(challenge.xdr, Networks.TESTNET) as Transaction,
    );
    expect(() => verifyHostedOwnershipProof(deploymentId, multiple, arrayProof)).not.toThrow();
    expect(() =>
      verifyHostedOwnershipProof(
        deploymentId,
        {
          ...multiple,
          payment: {
            ...multiple.payment,
            arguments: { version: 1, inputs: [...multiple.payment.arguments.inputs].reverse() },
          },
        },
        arrayProof,
      ),
    ).toThrow();
  });
  it("refuses expiry, future issuance, unbounded/extended timebounds and noncanonical envelope fields", () => {
    const original = challengeTx();
    const min = Number(original.timeBounds!.minTime),
      max = Number(original.timeBounds!.maxTime);
    const build = (changes: {
      fee?: string;
      minTime?: number;
      maxTime?: number;
      sequence?: string;
      memo?: boolean;
      source?: string;
      extra?: boolean;
      operationSource?: string;
      value?: string;
      name?: string;
      extraSigner?: boolean;
      ledger?: boolean;
    }) => {
      const op = original.operations[0]!;
      if (op.type !== "manageData") throw new Error("fixture");
      const builder = new TransactionBuilder(
        new Account(changes.source ?? payment.from, changes.sequence ?? "-1"),
        {
          fee: changes.fee ?? "100",
          networkPassphrase: Networks.TESTNET,
          timebounds: { minTime: changes.minTime ?? min, maxTime: changes.maxTime ?? max },
          ...(changes.memo ? { memo: Memo.text("changed") } : {}),
          ...(changes.extraSigner ? { extraSigners: [bob] } : {}),
          ...(changes.ledger ? { ledgerbounds: { minLedger: 1, maxLedger: 2 } } : {}),
        },
      ).addOperation(
        Operation.manageData({
          name: changes.name ?? op.name,
          value: changes.value ?? op.value!,
          ...(changes.operationSource ? { source: changes.operationSource } : {}),
        }),
      );
      if (changes.extra)
        builder.addOperation(Operation.manageData({ name: "extra", value: "extra" }));
      return builder.build();
    };
    for (const changes of [
      { fee: "101" },
      { sequence: "0" },
      { memo: true },
      { source: bob },
      { extra: true },
      { operationSource: payment.from },
      { value: "altered" },
      { name: "other" },
      { minTime: min - 1 },
      { maxTime: 0 },
      { maxTime: max + 1 },
      { extraSigner: true },
      { ledger: true },
    ])
      expect(() =>
        verifyHostedOwnershipProof(deploymentId, input, signed(build(changes))),
      ).toThrow();
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      signer,
      "100",
      original,
      Networks.TESTNET,
    );
    expect(() => verifyHostedOwnershipProof(deploymentId, input, signed(bump))).toThrow();
    const proof = signed(original);
    vi.spyOn(Date, "now").mockReturnValue((min - 1) * 1000);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, proof)).toThrow();
    vi.spyOn(Date, "now").mockReturnValue(max * 1000);
    expect(() => verifyHostedOwnershipProof(deploymentId, input, proof)).toThrow();
  });
  it("client rejects payment/foreign-payer/mutated challenge bodies before opening wallet", () => {
    const challenge = createHostedOwnershipChallenge(deploymentId, input);
    expect(() => assertHostedOwnershipChallenge(challenge, bob, "testnet")).toThrow();
    expect(() => assertHostedOwnershipChallenge(challenge, payment.from, "mainnet")).toThrow();
    const tx = new TransactionBuilder(new Account(payment.from, "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: bob, asset: Asset.native(), amount: "1" }))
      .setTimeout(180);
    // An ordinary non-zero transaction is rejected even if its operation is harmless.
    const other = new TransactionBuilder(new Account(payment.from, "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "ordinary", value: "x" }))
      .setTimeout(180)
      .build();
    expect(() =>
      assertHostedOwnershipChallenge(
        { ...challenge, xdr: tx.build().toXDR() },
        payment.from,
        "testnet",
      ),
    ).toThrow();
    expect(() =>
      assertHostedOwnershipChallenge({ ...challenge, xdr: other.toXDR() }, payment.from, "testnet"),
    ).toThrow();
  });
  it("strict schemas reject unknown credentials/proof objects and bound proof size", () => {
    expect(HostedOwnershipRequestSchema.safeParse({ ...input, token: "secret" }).success).toBe(
      false,
    );
    expect(
      HostedOwnershipRequestSchema.safeParse({ ...input, ownershipProofXdr: "proof" }).success,
    ).toBe(false);
    expect(
      HostedPrepareSchema.safeParse({ ...input, ownershipProofXdr: "x".repeat(4097) }).success,
    ).toBe(false);
    expect(
      HostedPrepareSchema.safeParse({ ...input, ownershipProofXdr: signed(challengeTx()) }).success,
    ).toBe(true);
    expect(
      HostedOwnershipChallengeSchema.safeParse({
        ...createHostedOwnershipChallenge(deploymentId, input),
        secret: "no",
      }).success,
    ).toBe(false);
  });
});
