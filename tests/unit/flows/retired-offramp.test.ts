import { describe, expect, it } from "vitest";
import { FlowGraphSchema, PayAction, SplitRecipient, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { hasRetiredPayoutInput } from "@/lib/flows/retired-inputs";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const pay = {
  id: "pay",
  type: "pay" as const,
  config: {
    recipient: ADDRESS,
    asset: { kind: "native" as const },
    mode: "fixed" as const,
    amountStroops: "10000000",
  },
};
const graph = {
  nodes: [{ id: "receive", type: "on_receive", config: { asset: { kind: "native" } } }, pay],
  edges: [{ id: "edge", source: "receive", target: "pay" }],
};

describe("retired off-ramp instructions", () => {
  it.each([
    { kind: "cash_out" },
    { kind: "cash_out_dev" },
    { type: "cash_out_dev" },
    { isCashOut: true },
    { is_cash_out: true },
    { templateKind: "CASH_OUT" },
    { templateKind: "CASH_OUT_DEV" },
  ])(
    "rejects obsolete compiled instructions before unknown fields can be stripped: %j",
    (params) => {
      expect(hasRetiredPayoutInput({ params })).toBe(true);
      expect(FlowGraphSchema.safeParse({ ...graph, params }).success).toBe(false);
    },
  );
  it("handles cyclic caller objects without recursion and still detects retired fields", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(hasRetiredPayoutInput(cyclic)).toBe(false);
    cyclic.params = { isCashOut: true };
    expect(hasRetiredPayoutInput(cyclic)).toBe(true);
  });
  it("preserves canvas positions whose node IDs happen to match retired field names", () => {
    const positioned = {
      ...graph,
      nodes: [graph.nodes[0], { ...pay, id: "accountName" }],
      edges: [{ id: "edge", source: "receive", target: "accountName" }],
      positions: {
        accountName: { x: 120, y: 40 },
        bankCode: { x: 0, y: 0 },
        accountNumber: { x: 1, y: 2 },
        senderKyc: { x: 3, y: 4 },
      },
    };
    expect(hasRetiredPayoutInput(positioned)).toBe(false);
    expect(FlowGraphSchema.parse(positioned).positions).toEqual(positioned.positions);
  });
  it.each([
    ...["accountName", "accountNumber", "bankCode"].flatMap((field) =>
      ["", "populated"].map((value) => ({ [field]: value })),
    ),
    { nested: { senderKyc: { firstName: "Retired" } } },
    { nested: { bankDetail: {} } },
    { nested: { kind: "cash_out" } },
    { nested: { templateKind: "CASH_OUT_DEV" } },
    { nested: { isCashOut: true } },
    { nested: { is_cash_out: true } },
    { nested: { payoutMode: "FIAT" } },
  ])("rejects retired metadata inside coordinate values before stripping: %j", (metadata) => {
    const retired = { ...graph, positions: { point: { x: 0, y: 0, ...metadata } } };
    const before = JSON.stringify(retired);
    expect(hasRetiredPayoutInput(retired)).toBe(true);
    expect(FlowGraphSchema.safeParse(retired).success).toBe(false);
    expect(validateFlow(retired).ok).toBe(false);
    expect(() => flowToPipeline(retired as unknown as FlowGraph)).toThrow();
    expect(JSON.stringify(retired)).toBe(before);
  });
  it.each([
    null,
    [],
    "coordinates",
    0,
    { point: null },
    { point: [] },
    { point: 0 },
    { point: "coordinate" },
    { point: { x: 0 } },
    { point: { x: 0, y: "0" } },
    { point: { x: Number.POSITIVE_INFINITY, y: 0 } },
  ])("rejects malformed canvas positions: %j", (positions) => {
    const malformed = { ...graph, positions };
    expect(hasRetiredPayoutInput(malformed)).toBe(true);
    expect(FlowGraphSchema.safeParse(malformed).success).toBe(false);
  });
  it.each([
    { payoutMode: "fiat" },
    { payoutMode: "FIAT" },
    { accountName: "Retired beneficiary" },
    { accountName: "" },
    { accountNumber: "00000001" },
    { bankCode: "RETIRED" },
  ])("rejects retired pay fields instead of stripping them: %j", (retired) => {
    expect(PayAction.safeParse({ ...pay, config: { ...pay.config, ...retired } }).success).toBe(
      false,
    );
  });

  it.each([{ payoutMode: "fiat" }, { accountNumber: "00000001" }, { bankCode: "RETIRED" }])(
    "rejects retired split-recipient fields: %j",
    (retired) => {
      expect(
        SplitRecipient.safeParse({ address: ADDRESS, mode: "percentage", bps: 10000, ...retired })
          .success,
      ).toBe(false);
    },
  );

  it.each([
    { ...graph, senderKyc: { firstName: "Retired", lastName: "Sender" } },
    {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "cash", type: "cash_out", config: { asset: { kind: "native" } } },
      ],
    },
    {
      ...graph,
      nodes: [graph.nodes[0], { ...pay, config: { ...pay.config, payoutMode: "fiat" } }],
    },
  ])("refuses retired graphs at schema, validation and compilation boundaries", (retired) => {
    const before = JSON.stringify(retired);
    expect(FlowGraphSchema.safeParse(retired).success).toBe(false);
    expect(validateFlow(retired).ok).toBe(false);
    // Simulate a persisted legacy graph bypassing the current TypeScript type.
    expect(() => flowToPipeline(retired as unknown as FlowGraph)).toThrow();
    expect(JSON.stringify(retired)).toBe(before);
  });

  it("continues compiling crypto payments without a cash-out child", () => {
    const parsed = FlowGraphSchema.parse(graph);
    expect(validateFlow(parsed).ok).toBe(true);
    const pipeline = flowToPipeline(parsed);
    expect(pipeline.map((node) => node.params.kind)).toEqual(["deposit_trigger", "payer"]);
    const payer = pipeline[1]!;
    expect(payer.params).toMatchObject({ kind: "payer", recipient: ADDRESS });
    expect(payer.params).not.toHaveProperty("isCashOut");
  });
});
