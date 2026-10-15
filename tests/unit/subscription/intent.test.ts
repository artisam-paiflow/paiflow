import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { createAllowanceIntent, verifyAllowanceIntent } from "@/lib/subscription/intent";
import {
  AllowancePrepareSchema,
  AllowanceSubmitSchema,
  MAX_ALLOWANCE,
} from "@/lib/subscription/schema";

const wallet = Keypair.random();
const other = Keypair.random();
const token = StrKey.encodeContract(Buffer.alloc(32, 1));
const spender = StrKey.encodeContract(Buffer.alloc(32, 2));
const id = "11111111-1111-4111-8111-111111111111";
const state = {
  preparationLedger: 90,
  deploymentId: id,
  network: "testnet" as const,
  subscriber: wallet.publicKey(),
  tokenContractAddress: token,
  contractAddress: spender,
};
function build(
  opts: {
    token?: string;
    spender?: string;
    amount?: string;
    expiry?: number;
    method?: string;
    source?: string;
    extra?: boolean;
    sequence?: string;
    network?: string;
  } = {},
) {
  const builder = new TransactionBuilder(
    new Account(opts.source ?? wallet.publicKey(), opts.sequence ?? "1"),
    { fee: BASE_FEE, networkPassphrase: opts.network ?? Networks.TESTNET },
  ).addOperation(
    new Contract(opts.token ?? token).call(
      opts.method ?? "approve",
      new Address(wallet.publicKey()).toScVal(),
      new Address(opts.spender ?? spender).toScVal(),
      nativeToScVal(BigInt(opts.amount ?? "200"), { type: "i128" }),
      nativeToScVal(opts.expiry ?? 12345, { type: "u32" }),
    ),
  );
  if (opts.extra)
    builder.addOperation(
      Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "1" }),
    );
  return builder.setTimeout(180).build();
}
afterEach(() => vi.restoreAllMocks());

describe("public subscription approval intent", () => {
  it("accepts only the exact prepared envelope signed by the subscriber", () => {
    const tx = build();
    const prepared = createAllowanceIntent(tx.toXDR(), state, "200");
    tx.sign(wallet);
    const result = verifyAllowanceIntent(prepared.intent, tx.toXDR(), id);
    expect(result.intent.txHash).toBe(prepared.txHash);
    expect(result.intent.preparationLedger).toBe(90);
    expect(result.signer.signedBySource).toBe(true);
    expect(verifyAllowanceIntent(prepared.intent, tx.toXDR(), id).intent.txHash).toBe(
      prepared.txHash,
    );
  });
  it("rejects tampering with the authenticated preparation ledger", () => {
    const tx = build();
    const prepared = createAllowanceIntent(tx.toXDR(), state, "200");
    const [payload, signature] = prepared.intent.split(".");
    const altered = JSON.parse(Buffer.from(payload!, "base64url").toString());
    altered.preparationLedger = 100;
    tx.sign(wallet);
    const intent = `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`;
    expect(() => verifyAllowanceIntent(intent, tx.toXDR(), id)).toThrow(/invalid or expired/);
  });
  it.each([0, -1, 1.5, 0x1_0000_0000])(
    "refuses invalid preparation ledger %s",
    (preparationLedger) => {
      expect(() =>
        createAllowanceIntent(build().toXDR(), { ...state, preparationLedger }, "200"),
      ).toThrow();
    },
  );
  it.each([
    { token: spender },
    { spender: token },
    { amount: "201" },
    { expiry: 12346 },
    { method: "transfer" },
    { source: other.publicKey() },
    { sequence: "2" },
    { extra: true },
  ])("refuses envelope tampering: %j", (change) => {
    const prepared = createAllowanceIntent(build().toXDR(), state, "200");
    const altered = build(change);
    altered.sign(wallet);
    expect(() => verifyAllowanceIntent(prepared.intent, altered.toXDR(), id)).toThrow(
      /does not match/,
    );
  });
  it.each([
    { token: spender },
    { spender: token },
    { amount: "201" },
    { method: "transfer" },
    { source: other.publicKey() },
    { extra: true },
  ])("refuses issuing an intent for an unintended operation: %j", (change) => {
    expect(() => createAllowanceIntent(build(change).toXDR(), state, "200")).toThrow(
      /not the intended/,
    );
  });
  it.each([0, 1000])("refuses invalid signatures after a %i ms clock advance", (clockAdvance) => {
    const tx = build();
    const unsignedXdr = tx.toXDR();
    const prepared = createAllowanceIntent(unsignedXdr, state, "200");
    const signatureError = expect.objectContaining({
      code: "FORBIDDEN",
      message: "Allowance must be signed by the configured subscriber on the deployment network",
    });
    expect(() => verifyAllowanceIntent(prepared.intent, unsignedXdr, id)).toThrow(signatureError);
    tx.sign(other);
    expect(() => verifyAllowanceIntent(prepared.intent, tx.toXDR(), id)).toThrow(signatureError);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + clockAdvance);
    // Reuse the prepared body: rebuilding would change its timeout across a clock tick.
    const wrongNetwork = TransactionBuilder.fromXDR(unsignedXdr, Networks.PUBLIC);
    expect(wrongNetwork.signatures).toHaveLength(0);
    wrongNetwork.sign(wallet);
    expect(
      TransactionBuilder.fromXDR(wrongNetwork.toXDR(), Networks.TESTNET).hash().toString("hex"),
    ).toBe(prepared.txHash);
    expect(() => verifyAllowanceIntent(prepared.intent, wrongNetwork.toXDR(), id)).toThrow(
      signatureError,
    );
    const correctNetwork = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
    correctNetwork.sign(wallet);
    expect(
      verifyAllowanceIntent(prepared.intent, correctNetwork.toXDR(), id).signer.signedBySource,
    ).toBe(true);
  });
  it("refuses cross-deployment, expired and tampered intents and malformed envelopes", () => {
    const tx = build();
    const prepared = createAllowanceIntent(tx.toXDR(), state, "200");
    tx.sign(wallet);
    expect(() => verifyAllowanceIntent(prepared.intent, tx.toXDR(), "another-deployment")).toThrow(
      /invalid or expired/,
    );
    expect(() => verifyAllowanceIntent(prepared.intent + "x", tx.toXDR(), id)).toThrow(
      /invalid or expired/,
    );
    expect(() => verifyAllowanceIntent(prepared.intent, "garbage", id)).toThrow(/envelope/);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect(() => verifyAllowanceIntent(prepared.intent, tx.toXDR(), id)).toThrow(
      /invalid or expired/,
    );
  });
});
describe("allowance request schemas", () => {
  it.each(["0", "-1", "1.1", "abc", "", (MAX_ALLOWANCE + 1n).toString(), "9".repeat(200)])(
    "rejects invalid amount %s",
    (amount) => {
      expect(
        AllowancePrepareSchema.safeParse({ amount, userAddress: wallet.publicKey() }).success,
      ).toBe(false);
    },
  );
  it("accepts exact integer bounds and rejects extra fields, invalid wallets, and oversized envelopes", () => {
    for (const amount of ["1", MAX_ALLOWANCE.toString()])
      expect(AllowancePrepareSchema.parse({ amount, userAddress: wallet.publicKey() }).amount).toBe(
        amount,
      );
    expect(AllowancePrepareSchema.safeParse({ amount: "1", userAddress: "Gbad" }).success).toBe(
      false,
    );
    expect(
      AllowancePrepareSchema.safeParse({ amount: "1", userAddress: wallet.publicKey(), spender })
        .success,
    ).toBe(false);
    expect(
      AllowanceSubmitSchema.safeParse({ signedXdr: "x".repeat(200001), intent: "x".repeat(20) })
        .success,
    ).toBe(false);
    expect(AllowanceSubmitSchema.safeParse({ signedXdr: "x".repeat(20) }).success).toBe(false);
  });
});
