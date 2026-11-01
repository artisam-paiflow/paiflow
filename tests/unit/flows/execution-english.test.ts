import { describe, expect, it } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToEnglish } from "@/lib/flows/english";
import { payoutRecipients } from "@/lib/flows/payout-recipients";
import { flowToPipeline } from "@/lib/flows/to-params";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OLD = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
function graph() {
  return FlowGraphSchema.parse({
    nodes: [
      {
        id: "receive",
        type: "on_receive",
        config: { asset: { kind: "native" }, minAmountStroops: "20000000" },
      },
      {
        id: "fee",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: ADDRESS,
          mode: "fixed",
          amountStroops: "10000000",
        },
      },
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            {
              rowId: "platform",
              label: "Platform",
              address: ADDRESS,
              mode: "percentage",
              bps: 1234,
            },
            { rowId: "worker", address: OLD, mode: "percentage", bps: 8766 },
          ],
        },
      },
    ],
    edges: [
      { id: "one", source: "receive", target: "fee" },
      { id: "two", source: "fee", target: "split" },
    ],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: "percentage",
          rows: [
            { rowId: "platform" },
            { rowId: "worker", recipient: "execution", allocation: "execution" },
          ],
          additionalRecipients: "execution",
        },
      ],
    },
  });
}
describe("policy-aware English/deployment review", () => {
  it("shows the actual compiled basis-point percentage when a Pay draft has finer precision", () => {
    const value = graph();
    const pay = value.nodes.find((node) => node.id === "fee");
    if (pay?.type !== "pay") throw new Error("Expected Pay");
    pay.config.mode = "percentage";
    pay.config.percentage = 12.345;
    const compiled = flowToPipeline(value).find((node) => node.nodeId === "fee");
    expect(compiled?.params).toMatchObject({ kind: "payer", percentageBps: 1235 });
    expect(flowToEnglish(value)).toContain("a constant 12.35% of this step’s incoming XLM");
    expect(flowToEnglish(value)).not.toContain("12.345%");
  });

  it("reviews every Pay hop and exact constants without presenting runtime placeholders as defaults", () => {
    const text = flowToEnglish(graph());
    expect(text).toContain("minimum 2 XLM");
    expect(text).toContain(`constant 1 XLM to constant recipient ${ADDRESS}`);
    expect(text).toContain("forward only this payment’s remainder");
    expect(text).toContain(`Platform (platform): constant 12.34% to constant recipient ${ADDRESS}`);
    expect(text).toContain(
      "worker: the allocation supplied by the payer to a recipient supplied by the payer",
    );
    expect(text).not.toContain(OLD);
    expect(text).not.toContain("87.66%");
    expect(text).toContain("additional recipients and their allocations supplied by the payer");
    expect(text).toContain("exactly 100%");
    expect(text).toContain("last row receives the rounding remainder");
    expect(text).toContain("Every declared input is required");
    expect(text).toContain("saved draft values are not defaults");
    expect(text).toContain("Template creation inputs and stored updates are separate");
  });

  it("reviews fixed execution funding without claiming constant accumulation semantics", () => {
    const value = graph();
    const split = value.nodes[2]!;
    if (split.type !== "split") throw new Error("Expected Split");
    split.config.recipients = split.config.recipients.map((row) => ({
      rowId: row.rowId,
      address: row.address,
      mode: "fixed",
      amountStroops: "10000000",
    }));
    const policy = value.fieldPolicies!.nodes[0]!;
    if (policy.kind !== "split") throw new Error("Expected policy");
    policy.allocationMode = "fixed";
    const text = flowToEnglish(value);
    expect(text).toContain("exactly match this payment’s funds entering the Split");
    expect(text).toContain("underfunding and excess are refused");
    expect(text).not.toContain("accumulate");
  });

  it("states terminal Pay refunds and excludes runtime recipients from deployment trustline checks", () => {
    const value = graph();
    value.nodes = value.nodes.slice(0, 2);
    value.edges = value.edges.slice(0, 1);
    value.fieldPolicies = {
      version: 1,
      nodes: [{ nodeId: "fee", kind: "pay", recipient: "execution", payoutValue: "constant" }],
    };
    const text = flowToEnglish(value);
    expect(text).toContain("recipient supplied by the payer for fee");
    expect(text).toContain("return any unused amount from this payment to its payer");
    expect(text).not.toContain(ADDRESS);
    expect(payoutRecipients(value)).toEqual([]);
    expect(payoutRecipients(graph()).map((row) => row.address)).toEqual([ADDRESS, ADDRESS]);
  });

  it("describes declared mutable initial values and refuses incompatible topology", () => {
    const value = graph();
    const policy = value.fieldPolicies!.nodes[0]!;
    if (policy.kind !== "split") throw new Error("Expected policy");
    policy.rows[0]!.recipient = "mutable";
    expect(flowToEnglish(value)).toContain(`initial stored recipient ${ADDRESS} (admin mutable)`);
    const incompatible = graph();
    incompatible.edges = [];
    expect(flowToEnglish(incompatible)).toContain("Fix the path before deploying");
  });
});

it("includes the initial stored mutable appended roster and its deployment trustline recipients", () => {
  const value = graph();
  const split = value.nodes[2];
  const policy = value.fieldPolicies!.nodes[0];
  if (split?.type !== "split" || policy?.kind !== "split") throw new Error();
  split.config.recipients = split.config.recipients.slice(0, 1);
  policy.rows = policy.rows.slice(0, 1);
  policy.additionalRecipients = "mutable";
  split.config.additionalRecipients = [
    { rowId: "initial", recipient: OLD, allocation: { kind: "percentage", bps: 8766 } },
  ];
  const text = flowToEnglish(value);
  expect(text).toContain(`initial: initial stored 87.66% to ${OLD}`);
  expect(text).toContain("admin may replace only this appended stored roster");
  expect(payoutRecipients(value).map((row) => row.address)).toEqual([ADDRESS, ADDRESS, OLD]);
});
