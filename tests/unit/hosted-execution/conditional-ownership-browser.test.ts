import {
  Account,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import {
  conditionalHostedOwnershipTransaction,
  assertConditionalHostedOwnershipChallenge,
} from "@/lib/stellar/conditional-ownership-transaction";
import { conditionalHostedOwnershipBinding } from "@/lib/hosted-execution/conditional-ownership-binding";
import {
  conditionalAcceptanceIntent,
  conditionalWorker,
} from "@/tests/fixtures/conditional-v2-acceptance";
const e = conditionalAcceptanceIntent(),
  input = {
    recoveryKey: "ab".repeat(32),
    payment: { from: e.payer, amount: e.amountStroops, arguments: e.arguments },
  },
  id = e.deploymentId;
async function fixture() {
  const min = Math.floor(Date.now() / 1000),
    bindingDigest = await conditionalHostedOwnershipBinding(id, input, "testnet", Networks.TESTNET),
    tx = conditionalHostedOwnershipTransaction(
      input.payment.from,
      bindingDigest,
      Networks.TESTNET,
      min,
    );
  return {
    version: 2 as const,
    bindingDigest,
    network: "testnet" as const,
    networkPassphrase: Networks.TESTNET,
    xdr: tx.toXDR(),
  };
}
it("checks independent original digest and exact sequence-zero sign-only transaction", async () => {
  const c = await fixture();
  await expect(
    assertConditionalHostedOwnershipChallenge(c, id.toUpperCase(), input, "testnet"),
  ).resolves.toBeUndefined();
  const tx = TransactionBuilder.fromXDR(c.xdr, Networks.TESTNET);
  expect("sequence" in tx && tx.sequence).toBe("0");
  expect(tx.fee).toBe("100");
  expect(tx.operations[0]).toMatchObject({
    type: "manageData",
    name: "paiflow.hosted-ownership.v2",
  });
});
it("rejects a self-consistent server challenge for another original request", async () => {
  const c = await fixture(),
    other = { ...input, payment: { ...input.payment, amount: "112" } };
  c.bindingDigest = await conditionalHostedOwnershipBinding(id, other, "testnet", Networks.TESTNET);
  c.xdr = conditionalHostedOwnershipTransaction(
    input.payment.from,
    c.bindingDigest,
    Networks.TESTNET,
    Math.floor(Date.now() / 1000),
  ).toXDR();
  await expect(assertConditionalHostedOwnershipChallenge(c, id, input, "testnet")).rejects.toThrow(
    /original request/,
  );
});
for (const [name, change] of [
  ["capability", () => ({ ...input, recoveryKey: "cd".repeat(32) })],
  ["payer", () => ({ ...input, payment: { ...input.payment, from: conditionalWorker } })],
  ["amount", () => ({ ...input, payment: { ...input.payment, amount: "112" } })],
  [
    "inputs",
    () => ({
      ...input,
      payment: { ...input.payment, arguments: { version: 2 as const, inputs: [] } },
    }),
  ],
] as const)
  it(`rejects binding ${name}`, async () =>
    await expect(
      assertConditionalHostedOwnershipChallenge(await fixture(), id, change(), "testnet"),
    ).rejects.toThrow());
it("rejects deployment, network and wallet-passphrase substitution", async () => {
  const c = await fixture();
  await expect(
    assertConditionalHostedOwnershipChallenge(
      c,
      "12281228-1228-4228-8228-122812281228",
      input,
      "testnet",
    ),
  ).rejects.toThrow();
  await expect(
    assertConditionalHostedOwnershipChallenge(c, id, input, "mainnet"),
  ).rejects.toThrow();
  await expect(
    assertConditionalHostedOwnershipChallenge(
      { ...c, networkPassphrase: "wallet supplied" },
      id,
      input,
      "testnet",
    ),
  ).rejects.toThrow();
});
for (const [name, options] of [
  ["fee", { fee: "101" }],
  ["sequence", { sequence: "0" }],
  ["old operation name", { name: "paiflow.hosted-ownership.v1" }],
  ["extra operation", { extra: true }],
  ["memo", { memo: true }],
  ["expired", { offset: -181 }],
  ["future", { offset: 1 }],
  ["infinite", { max: 0 }],
] as const)
  it(`rejects sign-only body ${name}`, async () => {
    const c = await fixture(),
      o: {
        fee?: string;
        sequence?: string;
        name?: string;
        extra?: boolean;
        memo?: boolean;
        offset?: number;
        max?: number;
      } = options,
      min = Math.floor(Date.now() / 1000) + (o.offset ?? 0),
      builder = new TransactionBuilder(new Account(input.payment.from, o.sequence ?? "-1"), {
        fee: o.fee ?? "100",
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: min, maxTime: o.max ?? min + 180 },
      }).addOperation(
        Operation.manageData({
          name: o.name ?? "paiflow.hosted-ownership.v2",
          value: c.bindingDigest,
        }),
      );
    if (o.extra) builder.addOperation(Operation.manageData({ name: "extra", value: null }));
    if (o.memo) builder.addMemo(Memo.text("extra"));
    c.xdr = builder.build().toXDR();
    await expect(
      assertConditionalHostedOwnershipChallenge(c, id, input, "testnet"),
    ).rejects.toThrow();
  });
it("rejects signed challenges and malformed constructor digest/window", async () => {
  const c = await fixture(),
    tx = TransactionBuilder.fromXDR(c.xdr, Networks.TESTNET);
  tx.sign(Keypair.random());
  c.xdr = tx.toXDR();
  await expect(
    assertConditionalHostedOwnershipChallenge(c, id, input, "testnet"),
  ).rejects.toThrow();
  expect(() =>
    conditionalHostedOwnershipTransaction(input.payment.from, "bad", Networks.TESTNET, 0),
  ).toThrow();
  expect(() =>
    conditionalHostedOwnershipTransaction(
      input.payment.from,
      c.bindingDigest,
      Networks.TESTNET,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toThrow();
});
