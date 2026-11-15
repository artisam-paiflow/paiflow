import { expect, it } from "vitest";
import { ConditionalExecutionDiscoverySchema } from "@/lib/api/v1/conditional-execution-schema";
import {
  conditionalHostedRequirements,
  conditionalFormArguments,
  conditionalHostedTermsIdentity,
} from "@/lib/hosted-execution/conditional-form";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptancePlan,
  conditionalWorker,
} from "@/tests/fixtures/conditional-v2-acceptance";
import { ConditionalDefinitionSchema } from "@/lib/flows/conditional-v2";
import type { AdditionalDraft, HostedFieldValues } from "@/lib/hosted-execution/form";
function state(definition = conditionalAcceptanceDefinition()) {
  const p = conditionalAcceptancePlan(definition),
    s = ConditionalExecutionDiscoverySchema.parse({
      version: 2,
      supported: true,
      policyVersion: 2,
      deploymentId: "12281228-1228-4228-8228-122812281228",
      network: "testnet",
      confirmedLedger: 100,
      definition,
      nodes: p.bindings,
      statuses: p.nodes.map((n) => ({ state: n.initialState, obligationsStroops: "0" })),
    });
  if (!s.supported) throw new Error();
  return s;
}
for (const kind of ["amount_gt", "amount_lt"] as const)
  for (const amount of ["109", "110", "111"])
    it(`${kind} funded${amount} selects strict post-prefix requirements`, () => {
      const s = state(conditionalAcceptanceDefinition(kind, "pay", "return_to_owner")),
        r = conditionalHostedRequirements(s, amount);
      expect(r.amountAtConditionStroops).toBe((BigInt(amount) - 10n).toString());
      expect(r.branch).toBe(
        kind === "amount_gt"
          ? amount === "111"
            ? "true"
            : "false"
          : amount === "109"
            ? "true"
            : "false",
      );
      expect(r.nodes.map((n) => n.nodeId)).toEqual(r.branch === "true" ? ["fee", "yes"] : ["fee"]);
      expect(
        conditionalFormArguments(
          s,
          amount,
          r.branch === "true" ? { "yes:pay:recipient": conditionalWorker } : {},
          {},
        ),
      ).toEqual({
        version: 2,
        inputs:
          r.branch === "true" ? [{ kind: "pay", nodeId: "yes", recipient: conditionalWorker }] : [],
      });
    });
it("builds only the selected Split roster in immutable configured order", () =>
  expect(
    conditionalFormArguments(
      state(),
      "111",
      {},
      { yes: [{ rowId: "worker", recipient: conditionalWorker, allocation: "90" }] },
    ),
  ).toEqual({
    version: 2,
    inputs: [
      {
        kind: "split",
        nodeId: "yes",
        rows: [],
        additionalRecipients: [
          {
            rowId: "worker",
            recipient: conditionalWorker,
            allocation: { kind: "percentage", bps: 9000 },
          },
        ],
      },
    ],
  }));
const invalid: Array<[string, HostedFieldValues, Record<string, AdditionalDraft[]>]> = [
  ["inactive field", { "no:pay:recipient": conditionalWorker }, {}],
  ["constant field", { "fee:pay:recipient": conditionalWorker }, {}],
  ["missing selected", {}, {}],
  ["inactive roster", {}, { no: [] }],
  ["constant roster", {}, { fee: [] }],
  ["bad total", {}, { yes: [{ rowId: "worker", recipient: conditionalWorker, allocation: "89" }] }],
  [
    "precision",
    {},
    { yes: [{ rowId: "worker", recipient: conditionalWorker, allocation: "90.001" }] },
  ],
];
for (const [name, fields, rosters] of invalid)
  it(`rejects ${name}`, () =>
    expect(() => conditionalFormArguments(state(), "111", fields, rosters)).toThrow());
it("prefix inputs remain required when selected branch returns to owner", () => {
  const d = conditionalAcceptanceDefinition();
  d.prefix[0]!.policy.recipient = "execution";
  delete d.prefix[0]!.configuration.recipient;
  const s = state(d);
  expect(() => conditionalFormArguments(s, "110", {}, {})).toThrow();
  expect(
    conditionalFormArguments(s, "110", { "fee:pay:recipient": conditionalWorker }, {}).inputs,
  ).toEqual([{ kind: "pay", nodeId: "fee", recipient: conditionalWorker }]);
});
it("percentage prefix floor changes the tested amount before strict equality", () => {
  const d = conditionalAcceptanceDefinition();
  d.prefix[0]!.configuration.payoutValue = { kind: "percentage", bps: 3333 };
  d.condition.thresholdStroops = "68";
  expect(conditionalHostedRequirements(state(d), "101")).toMatchObject({
    branch: "false",
    amountAtConditionStroops: "68",
  });
});
it.each(["0", ((1n << 127n) - 1n).toString()])("threshold boundary%s", (threshold) => {
  const d = conditionalAcceptanceDefinition();
  d.condition.thresholdStroops = threshold;
  expect(conditionalHostedRequirements(state(d), "111").amountAtConditionStroops).toBe("101");
});
it.each(["0", "00", "-1", (1n << 127n).toString()])("rejects payment%s", (amount) =>
  expect(() => conditionalHostedRequirements(state(), amount)).toThrow(),
);
it("terms identity excludes ledger/debt churn while binding inactive artifacts and threshold", () => {
  const s = state(),
    identity = conditionalHostedTermsIdentity(s),
    c = structuredClone(s);
  c.confirmedLedger++;
  c.statuses[3]!.obligationsStroops = "99";
  expect(conditionalHostedTermsIdentity(c)).toBe(identity);
  c.nodes.at(-1)!.wasmHash = "ab".repeat(32);
  expect(conditionalHostedTermsIdentity(c)).not.toBe(identity);
  const d = structuredClone(s.definition);
  d.condition.thresholdStroops = "101";
  expect(conditionalHostedTermsIdentity(state(d))).not.toBe(identity);
});
it("fixed execution funding must equal incoming; stored obligations do not block payment", () => {
  const d = conditionalAcceptanceDefinition();
  if (d.trueBranch.kind !== "split") throw new Error();
  d.trueBranch.policy.allocationMode = "fixed";
  d.trueBranch.configuration.configuredRows[0]!.allocation = { kind: "fixed", amountStroops: "10" };
  const s = state(ConditionalDefinitionSchema.parse(d));
  s.statuses[3]!.obligationsStroops = "100";
  expect(
    conditionalFormArguments(
      s,
      "111",
      {},
      { yes: [{ rowId: "worker", recipient: conditionalWorker, allocation: "0.0000091" }] },
    ).inputs,
  ).toHaveLength(1);
  expect(() =>
    conditionalFormArguments(
      s,
      "111",
      {},
      { yes: [{ rowId: "worker", recipient: conditionalWorker, allocation: "0.0000092" }] },
    ),
  ).toThrow();
});
