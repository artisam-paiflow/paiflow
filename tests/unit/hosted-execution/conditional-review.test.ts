import { Account, Contract, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import {
  conditionalHostedPaymentReview,
  assertConditionalHostedPrepared,
  assertConditionalHostedCurrent,
} from "@/lib/hosted-execution/conditional-review";
import { ConditionalExecutionDiscoverySchema } from "@/lib/api/v1/conditional-execution-schema";
import { ConditionalExecutionIntentSchema } from "@/lib/flows/conditional-v2";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptanceIntent,
  conditionalAcceptancePlan,
  conditionalAcceptanceScenarios,
  conditionalOwner,
  conditionalPayer,
  conditionalWorker,
} from "@/tests/fixtures/conditional-v2-acceptance";
function wrapper(execution = conditionalAcceptanceIntent()) {
  const tx = new TransactionBuilder(new Account(execution.payer, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(execution.rootContract).call("execute_v2", ...executionV2Args(execution)),
    )
    .setTimeout(180)
    .build();
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
const request = (w: ReturnType<typeof wrapper>) => ({
  from: w.prepared.execution.payer,
  amount: w.prepared.execution.amountStroops,
  arguments: w.prepared.execution.arguments,
});
function current(e = conditionalAcceptanceIntent()) {
  const p = conditionalAcceptancePlan(e.definition),
    s = ConditionalExecutionDiscoverySchema.parse({
      version: 2,
      supported: true,
      policyVersion: 2,
      deploymentId: e.deploymentId,
      network: "testnet",
      confirmedLedger: 10,
      definition: e.definition,
      nodes: e.nodes,
      statuses: p.nodes.map((n) => ({ state: n.initialState, obligationsStroops: "0" })),
    });
  if (!s.supported) throw new Error();
  return s;
}
for (const scenario of conditionalAcceptanceScenarios)
  it(`${scenario.name} actual prepared review conserves invocation and excludes inactive branch`, () => {
    for (const amount of ["109", "110", "111"]) {
      const intent = conditionalAcceptanceIntent(scenario.definition, amount),
        w = wrapper(intent);
      expect(() =>
        assertConditionalHostedPrepared(intent.deploymentId, "testnet", request(w), w),
      ).not.toThrow();
      expect(w.rows.reduce((s, r) => s + BigInt(r.amountStroops), BigInt(w.refundStroops))).toBe(
        BigInt(amount),
      );
      expect(
        w.rows.filter((r) => r.nodeId === (intent.selectedBranch === "true" ? "no" : "yes")),
      ).toEqual([]);
    }
  });
it("semantic Return pays full branch budget to owner distinct from payer, with no refund", () => {
  const w = wrapper(conditionalAcceptanceIntent(undefined, "110"));
  expect(conditionalOwner).not.toBe(conditionalPayer);
  expect(w.rows.at(-1)).toMatchObject({
    kind: "return_to_owner",
    recipient: conditionalOwner,
    amountStroops: "100",
    recipientSource: "constant",
    allocationSource: "constant",
  });
  expect(w.rows.at(-1)!.allocation).toContain("not a payer refund");
  expect(w.refundStroops).toBe("0");
});
it("fixed terminal Pay refunds only invocation leftover", () => {
  const w = wrapper(
    conditionalAcceptanceIntent(
      conditionalAcceptanceDefinition("amount_gt", "pay", "return_to_owner"),
      "111",
    ),
  );
  expect(w.rows.at(-1)).toMatchObject({
    kind: "pay",
    recipient: conditionalWorker,
    amountStroops: "20",
  });
  expect(w.refundStroops).toBe("81");
});
it("last Split row takes the percentage remainder", () => {
  const w = wrapper();
  expect(w.rows.filter((r) => r.kind === "split").map((r) => r.amountStroops)).toEqual([
    "10",
    "91",
  ]);
  expect(w.rows.at(-1)!.allocation).toContain("rounding remainder");
});
it("stored fixed Split rows are configured batches, not immediate payouts", () => {
  const e = conditionalAcceptanceIntent(),
    n = e.definition.trueBranch;
  if (n.kind !== "split") throw new Error();
  n.policy = {
    kind: "split",
    nodeId: n.nodeId,
    allocationMode: "fixed",
    additionalRecipients: "constant",
    rows: [{ rowId: "batch", recipient: "constant", allocation: "constant" }],
  };
  n.configuration = {
    kind: "split",
    configuredRows: [
      {
        rowId: "batch",
        recipient: conditionalWorker,
        allocation: { kind: "fixed", amountStroops: "200" },
      },
    ],
    additionalRecipients: [],
  };
  e.arguments = { version: 2, inputs: [] };
  const review = conditionalHostedPaymentReview(ConditionalExecutionIntentSchema.parse(e));
  expect(review.accumulation).toBe(true);
  expect(review.rows.at(-1)!.amountStroops).toBe("200");
  expect(review.rows.at(-1)!.allocation).toContain("not an immediate payout claim");
  expect(review.refundStroops).toBe("0");
});
for (const [name, change] of [
  ["recipient", (w: ReturnType<typeof wrapper>) => (w.rows.at(-1)!.recipient = conditionalPayer)],
  ["amount", (w: ReturnType<typeof wrapper>) => (w.rows.at(-1)!.amountStroops = "1")],
  ["semantic kind", (w: ReturnType<typeof wrapper>) => (w.rows.at(-1)!.kind = "return_to_owner")],
  ["refund", (w: ReturnType<typeof wrapper>) => (w.refundStroops = "1")],
  ["batch", (w: ReturnType<typeof wrapper>) => (w.accumulation = true)],
  ["fee", (w: ReturnType<typeof wrapper>) => (w.feeStroops = "101")],
] as const)
  it(`rejects altered ${name} review`, () => {
    const w = wrapper();
    change(w);
    expect(() =>
      assertConditionalHostedPrepared(w.prepared.execution.deploymentId, "testnet", request(w), w),
    ).toThrow();
  });
it("cross-binds request identity and actual UUID letter case", () => {
  const w = wrapper({
    ...conditionalAcceptanceIntent(),
    deploymentId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
  });
  expect(() =>
    assertConditionalHostedPrepared(
      w.prepared.execution.deploymentId.toUpperCase(),
      "testnet",
      request(w),
      w,
    ),
  ).not.toThrow();
  for (const r of [
    { ...request(w), amount: "112" },
    { ...request(w), from: conditionalOwner },
    { ...request(w), arguments: { version: 2 as const, inputs: [] } },
  ])
    expect(() =>
      assertConditionalHostedPrepared(w.prepared.execution.deploymentId, "testnet", r, w),
    ).toThrow();
  expect(() =>
    assertConditionalHostedPrepared(w.prepared.intent, "testnet", request(w), w),
  ).toThrow();
  expect(() =>
    assertConditionalHostedPrepared(w.prepared.execution.deploymentId, "mainnet", request(w), w),
  ).toThrow();
});
it("current matching ignores ledger/debt but rejects inactive hash changes", () => {
  const e = conditionalAcceptanceIntent(),
    s = current(e);
  s.confirmedLedger++;
  s.statuses[3]!.obligationsStroops = "20";
  expect(() => assertConditionalHostedCurrent(s, e)).not.toThrow();
  s.nodes.at(-1)!.wasmHash = "ab".repeat(32);
  expect(() => assertConditionalHostedCurrent(s, e)).toThrow();
});
it("valid inactive mutable revision invalidates the original even after values restored", async () => {
  const { conditionalMutationDefinition } =
      await import("@/tests/fixtures/conditional-v2-mutation-acceptance"),
    definition = conditionalMutationDefinition(),
    plan = conditionalAcceptancePlan(definition),
    e = ConditionalExecutionIntentSchema.parse({
      ...conditionalAcceptanceIntent(),
      definition,
      nodes: plan.bindings,
      arguments: { version: 2, inputs: [] },
    }),
    s = current(e);
  expect(() => assertConditionalHostedCurrent(s, e)).not.toThrow();
  s.nodes.at(-1)!.expectedRevision = "2";
  s.statuses.at(-1)!.state.revision = "2";
  expect(ConditionalExecutionDiscoverySchema.safeParse(s).success).toBe(true);
  expect(() => assertConditionalHostedCurrent(s, e)).toThrow();
});
it("valid threshold update requires original reconciliation, never route rebase", () => {
  const e = conditionalAcceptanceIntent(),
    definition = structuredClone(e.definition);
  definition.condition.thresholdStroops = "101";
  const plan = conditionalAcceptancePlan(definition),
    s = current({ ...e, definition, nodes: plan.bindings });
  expect(() => assertConditionalHostedCurrent(s, e)).toThrow();
  expect(e.selectedBranch).toBe("true");
});
