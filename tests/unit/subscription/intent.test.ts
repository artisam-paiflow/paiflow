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
    expect(result.signer.signedBySource).toBe(true);
    expect(verifyAllowanceIntent(prepared.intent, tx.toXDR(), id).intent.txHash).toBe(
      prepared.txHash,
    );
  });
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
  it("refuses unsigned, wrong wallet and wrong network signatures", () => {
    const tx = build();
    const prepared = createAllowanceIntent(tx.toXDR(), state, "200");
    expect(() => verifyAllowanceIntent(prepared.intent, tx.toXDR(), id)).toThrow(/signed/);
    tx.sign(other);
    expect(() => verifyAllowanceIntent(prepared.intent, tx.toXDR(), id)).toThrow(/signed/);
    const wrongNetwork = build({ network: Networks.PUBLIC });
    wrongNetwork.sign(wallet);
    expect(() => verifyAllowanceIntent(prepared.intent, wrongNetwork.toXDR(), id)).toThrow(
      /signed/,
    );
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
