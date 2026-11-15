import {
  Account,
  Address,
  Contract,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { assertConditionalExecutionEnvelope } from "@/lib/stellar/conditional-execution-review";
import { conditionalHostedPaymentReview } from "@/lib/hosted-execution/conditional-review";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalAcceptanceIntent,
  conditionalOwner,
} from "@/tests/fixtures/conditional-v2-acceptance";
const execution = conditionalAcceptanceIntent();
function fixture(
  o: {
    root?: string;
    method?: string;
    args?: xdr.ScVal[];
    source?: string;
    fee?: string;
    memo?: boolean;
    extra?: boolean;
    infinite?: boolean;
    auth?: xdr.SorobanAuthorizationEntry[];
  } = {},
) {
  const builder = new TransactionBuilder(new Account(o.source ?? execution.payer, "1"), {
    fee: o.fee ?? "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(
    o.auth
      ? Operation.invokeContractFunction({
          contract: o.root ?? execution.rootContract,
          function: o.method ?? "execute_v2",
          args: o.args ?? executionV2Args(execution),
          auth: o.auth,
        })
      : new Contract(o.root ?? execution.rootContract).call(
          o.method ?? "execute_v2",
          ...(o.args ?? executionV2Args(execution)),
        ),
  );
  if (o.memo) builder.addMemo(Memo.text("unreviewed"));
  if (o.extra) builder.addOperation(Operation.manageData({ name: "extra", value: null }));
  builder.setTimeout(o.infinite ? 0 : 180);
  const tx = builder.build();
  return {
    version: 2 as const,
    prepared: {
      intent: "12281228-1228-4228-8228-122812281228",
      txHash: tx.hash().toString("hex"),
      walletAddress: execution.payer,
      xdr: tx.toXDR(),
      network: "testnet" as const,
      networkPassphrase: Networks.TESTNET,
      expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
      execution,
    },
    feeStroops: tx.fee,
    ...conditionalHostedPaymentReview(execution),
  };
}
it("accepts exact original execute_v2 envelope", () =>
  expect(() => assertConditionalExecutionEnvelope(fixture())).not.toThrow());
for (const [name, options] of [
  ["root", { root: execution.nodes[1]!.contractAddress }],
  ["v1 method", { method: "execute_v1" }],
  ["mutation method", { method: "mutate_v2" }],
  ["missing arg", { args: executionV2Args(execution).slice(0, 7) }],
  ["source", { source: conditionalOwner }],
  ["memo", { memo: true }],
  ["extra operation", { extra: true }],
  ["infinite", { infinite: true }],
] as const)
  it(`rejects changed ${name} even with recomputed transaction hash`, () =>
    expect(() => assertConditionalExecutionEnvelope(fixture(options))).toThrow());
it("binds every actual execute argument including nonce", () => {
  const changed = structuredClone(execution);
  changed.nonce = "cd".repeat(32);
  expect(() =>
    assertConditionalExecutionEnvelope(fixture({ args: executionV2Args(changed) })),
  ).toThrow();
});
it("rejects signed original and fee/hash/expiry substitutions", () => {
  const w = fixture(),
    tx = TransactionBuilder.fromXDR(w.prepared.xdr, Networks.TESTNET);
  tx.sign(Keypair.random());
  expect(() =>
    assertConditionalExecutionEnvelope({ ...w, prepared: { ...w.prepared, xdr: tx.toXDR() } }),
  ).toThrow();
  for (const c of [
    { ...w, feeStroops: "101" },
    { ...w, feeStroops: "0" },
    { ...w, prepared: { ...w.prepared, txHash: "00".repeat(32) } },
    { ...w, prepared: { ...w.prepared, expiresAt: "2099-01-01T00:00:00.000Z" } },
  ])
    expect(() => assertConditionalExecutionEnvelope(c)).toThrow();
});
it("accepts source credentials but refuses address-credential signing protocols", () => {
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(execution.rootContract).toScAddress(),
        functionName: "execute_v2",
        args: executionV2Args(execution),
      }),
    ),
    subInvocations: [],
  });
  const source = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation,
  });
  expect(() => assertConditionalExecutionEnvelope(fixture({ auth: [source] }))).not.toThrow();
  const other = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(execution.payer).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation,
  });
  expect(() => assertConditionalExecutionEnvelope(fixture({ auth: [other] }))).toThrow();
});
