import { describe, expect, it } from "vitest";
import {
  ConditionalCanvasSchema,
  type ConditionalCanvas,
} from "@/lib/flows/conditional-canvas-schema";
import {
  conditionalCanvasIssues,
  conditionalDefinitionFromCanvas,
  conditionalCanvasEnglish,
  conditionalDefinitionEnglish,
  conditionalArtifactAvailability,
} from "@/lib/flows/conditional-canvas";
import { selectConditionalBranch } from "@/lib/flows/conditional-v2";
import { flowToEnglish } from "@/lib/flows/english";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import {
  readOrdinaryFlowGraph,
  ordinaryFlowParameters,
  ordinarySandboxNotifications,
  validateOrdinaryFlow,
} from "@/lib/flows/ordinary-flow";
const OWNER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  THIRD = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6",
  ASSET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
function draft(): ConditionalCanvas {
  return ConditionalCanvasSchema.parse({
    generation: "conditional-v2",
    conditionalPolicies: { version: 2, nodes: [] },
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "fee",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: OTHER, mode: "fixed", amountStroops: "10" },
      },
      { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "50" } },
      {
        id: "yes",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: THIRD,
          mode: "percentage",
          percentage: 100,
          fullAmount: true,
        },
      },
      { id: "no", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "a", source: "receive", target: "fee" },
      { id: "b", source: "fee", target: "condition" },
      { id: "c", source: "condition", target: "yes", sourceHandle: "true" },
      { id: "d", source: "condition", target: "no", sourceHandle: "false" },
    ],
    positions: { receive: { x: 10, y: 20 } },
  });
}
const convert = (d: ConditionalCanvas) =>
  conditionalDefinitionFromCanvas(d, { owner: OWNER, assetContract: ASSET });
describe("explicit conditional canvas domain", () => {
  it("converts complete topology in canonical order and retains immutable Return semantics", () => {
    const d = draft();
    d.nodes.reverse();
    d.edges.reverse();
    const definition = convert(d);
    expect(conditionalCanvasIssues(d)).toEqual([]);
    expect(definition.prefix.map((n) => n.nodeId)).toEqual(["fee"]);
    expect(definition.trueBranch.nodeId).toBe("yes");
    expect(definition.falseBranch).toEqual({ kind: "return_to_owner", nodeId: "no" });
    expect(definition.owner).toBe(OWNER);
    expect(definition.condition.thresholdMode).toBe("constant");
    expect(d.nodes.find((n) => n.id === "no")?.type).toBe("return_to_owner");
  });
  it.each(["amount_gt", "amount_lt"] as const)("uses strict %s post-prefix comparison", (kind) => {
    const d = draft(),
      c = d.nodes.find((n) => n.type === "condition")!;
    if (c.type !== "condition") throw new Error();
    c.config = { kind, amountStroops: "50" };
    const def = convert(d);
    expect(selectConditionalBranch(def, "60").selectedBranch).toBe("false");
    expect(selectConditionalBranch(def, "59").selectedBranch).toBe(
      kind === "amount_lt" ? "true" : "false",
    );
    expect(selectConditionalBranch(def, "61").selectedBranch).toBe(
      kind === "amount_gt" ? "true" : "false",
    );
    expect(selectConditionalBranch(def, "55").amountAtConditionStroops).toBe("45");
  });
  it.each(["0", ((1n << 127n) - 1n).toString()])("accepts threshold boundary %s", (threshold) => {
    const d = draft(),
      c = d.nodes.find((n) => n.type === "condition")!;
    if (c.type !== "condition") throw new Error();
    c.config = { kind: "amount_gt", amountStroops: threshold };
    d.conditionalPolicies.condition = { nodeId: c.id, thresholdMode: "mutable" };
    expect(convert(d).condition).toMatchObject({
      thresholdStroops: threshold,
      thresholdMode: "mutable",
    });
  });
  it("requires real explicit owner and asset identities at strict conversion", () => {
    expect(() =>
      conditionalDefinitionFromCanvas(draft(), { owner: "", assetContract: ASSET }),
    ).toThrow();
    expect(() =>
      conditionalDefinitionFromCanvas(draft(), { owner: OWNER, assetContract: "" }),
    ).toThrow();
  });
  it("keeps saveable incomplete drafts separate from validation and executable metadata", () => {
    const d = draft();
    d.edges = [];
    expect(readOrdinaryFlowGraph(d)).toEqual(d);
    expect(validateOrdinaryFlow(d).ok).toBe(false);
    expect(ordinaryFlowParameters(d)).toEqual({
      templateKind: "ROUTER",
      parameters: { generation: "conditional-v2", version: 2, draft: true },
    });
    expect(() => convert(d)).toThrow();
  });
  it("preserves metadata and removes sandbox notification addresses", () => {
    const d = draft();
    d.notify = { mode: "every_transaction", sendTo: "private@example.com" };
    const sanitized = ordinarySandboxNotifications(d);
    expect(sanitized).toMatchObject({
      generation: "conditional-v2",
      conditionalPolicies: d.conditionalPolicies,
      positions: d.positions,
      notify: { mode: "off", sendTo: "" },
    });
  });
  it("does not reinterpret v2 as v1 or change retained immediate compilation", () => {
    expect(() => FlowGraphSchema.parse(draft())).toThrow();
    expect(() => flowToPipeline(draft() as never)).toThrow();
    const old = FlowGraphSchema.parse({
      nodes: [
        { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "pay",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: OWNER,
            mode: "fixed",
            amountStroops: "1",
          },
        },
      ],
      edges: [{ id: "edge", source: "root", target: "pay" }],
    });
    expect(flowToPipeline(old).map((n) => n.templateKind)).toEqual(["DEPOSIT_TRIGGER", "PAYER"]);
    expect(flowToEnglish(old)).not.toContain("Equality");
  });
});
const invalid: Array<[string, (d: ConditionalCanvas) => void]> = [
  ["missing explicit branch", (d) => delete d.edges[2]!.sourceHandle],
  ["duplicate true branch", (d) => (d.edges[3]!.sourceHandle = "true")],
  ["missing target", (d) => (d.edges[3]!.target = "missing")],
  ["cycle", (d) => (d.edges[1]!.target = "receive")],
  ["join", (d) => (d.edges[3]!.target = "yes")],
  ["branch chain", (d) => d.edges.push({ id: "extra", source: "yes", target: "no" })],
  ["disconnected block", (d) => d.nodes.push({ id: "extra", type: "return_to_owner", config: {} })],
  [
    "nested condition",
    (d) =>
      d.nodes.push({
        id: "nested",
        type: "condition",
        config: { kind: "amount_lt", amountStroops: "1" },
      }),
  ],
  ["upstream branch handle", (d) => (d.edges[0]!.sourceHandle = "true")],
  [
    "full prefix",
    (d) => {
      const n = d.nodes[1]!;
      if (n.type === "pay") n.config.fullAmount = true;
    },
  ],
  [
    "100 percent prefix",
    (d) => {
      const n = d.nodes[1]!;
      if (n.type === "pay") Object.assign(n.config, { mode: "percentage", percentage: 100 });
    },
  ],
  [
    "wrong asset",
    (d) => {
      const n = d.nodes[1]!;
      if (n.type === "pay") n.config.asset = { kind: "known", symbol: "USDC" };
    },
  ],
  [
    "bad prefix amount",
    (d) => {
      const n = d.nodes[1]!;
      if (n.type === "pay") n.config.amountStroops = "00";
    },
  ],
  [
    "invalid recipient",
    (d) => {
      const n = d.nodes[1]!;
      if (n.type === "pay") n.config.recipient = "G";
    },
  ],
  [
    "missing threshold",
    (d) => {
      const n = d.nodes[2]!;
      if (n.type === "condition" && n.config.kind === "amount_gt") n.config.amountStroops = "";
    },
  ],
  [
    "threshold leading zero",
    (d) => {
      const n = d.nodes[2]!;
      if (n.type === "condition" && n.config.kind === "amount_gt") n.config.amountStroops = "01";
    },
  ],
  [
    "threshold overflow",
    (d) => {
      const n = d.nodes[2]!;
      if (n.type === "condition" && n.config.kind === "amount_gt")
        n.config.amountStroops = (1n << 127n).toString();
    },
  ],
  [
    "mutable full Pay",
    (d) =>
      d.conditionalPolicies.nodes.push({
        nodeId: "yes",
        kind: "pay",
        recipient: "constant",
        payoutValue: "mutable",
      }),
  ],
];
it.each(invalid)("refuses %s before deployment", (_name, mutate) => {
  const d = draft();
  mutate(d);
  expect(conditionalCanvasIssues(d).length).toBeGreaterThan(0);
  expect(() => convert(d)).toThrow();
  expect(conditionalArtifactAvailability(d, CONDITIONAL_V2_WASM_HASHES).available).toBe(false);
});
function splitDraft(): ConditionalCanvas {
  const d = draft();
  d.nodes[3] = {
    id: "yes",
    type: "split",
    config: {
      asset: { kind: "native" },
      recipients: [
        { rowId: "a", address: OTHER, mode: "percentage", bps: 3333 },
        { rowId: "b", address: THIRD, mode: "percentage", bps: 6667 },
      ],
    },
  };
  d.conditionalPolicies.nodes = [
    {
      kind: "split",
      nodeId: "yes",
      allocationMode: "percentage",
      additionalRecipients: "constant",
      rows: [
        { rowId: "a", recipient: "constant", allocation: "constant" },
        { rowId: "b", recipient: "constant", allocation: "constant" },
      ],
    },
  ];
  return d;
}
it("converts Split execution fields without retaining draft display values as defaults", () => {
  const d = splitDraft(),
    p = d.conditionalPolicies.nodes[0];
  if (p?.kind !== "split") throw new Error();
  p.rows[1]!.recipient = "execution";
  p.rows[1]!.allocation = "execution";
  const n = d.nodes[3];
  if (n?.type !== "split") throw new Error();
  n.config.recipients[1]!.address = "";
  n.config.recipients[1]!.mode = "percentage";
  const def = convert(d);
  expect(def.trueBranch.kind).toBe("split");
  if (def.trueBranch.kind !== "split") throw new Error();
  expect(def.trueBranch.configuration.configuredRows[1]).toEqual({ rowId: "b" });
  expect(conditionalCanvasEnglish(d)).toContain("payer-supplied allocation");
});
for (const [name, mutate] of [
  [
    "duplicate recipient",
    (d: ConditionalCanvas) => {
      const n = d.nodes[3];
      if (n?.type === "split") n.config.recipients[1]!.address = OTHER;
    },
  ],
  [
    "bad percentage total",
    (d: ConditionalCanvas) => {
      const n = d.nodes[3];
      if (n?.type === "split" && n.config.recipients[0]?.mode === "percentage")
        n.config.recipients[0].bps = 3334;
    },
  ],
  [
    "row mismatch",
    (d: ConditionalCanvas) => {
      const n = d.nodes[3];
      if (n?.type === "split") n.config.recipients[0]!.rowId = "other";
    },
  ],
  [
    "deferred split",
    (d: ConditionalCanvas) => {
      const n = d.nodes[3];
      if (n?.type === "split") n.config.ratePerSecondStroops = "1";
    },
  ],
  [
    "undeclared roster",
    (d: ConditionalCanvas) => {
      const n = d.nodes[3];
      if (n?.type === "split") n.config.additionalRecipients = [];
    },
  ],
] as const)
  it(`refuses Split ${name}`, () => {
    const d = splitDraft();
    mutate(d);
    expect(conditionalCanvasIssues(d).length).toBeGreaterThan(0);
    expect(() => convert(d)).toThrow();
  });
it("preserves fixed Split accumulation and rejects combined i128 overflow", () => {
  const d = splitDraft(),
    p = d.conditionalPolicies.nodes[0],
    n = d.nodes[3];
  if (p?.kind !== "split" || n?.type !== "split") throw new Error();
  p.allocationMode = "fixed";
  n.config.recipients = n.config.recipients.map((r) => ({
    ...r,
    mode: "fixed" as const,
    amountStroops: "10",
  }));
  expect(conditionalCanvasIssues(d)).toEqual([]);
  expect(conditionalDefinitionEnglish(convert(d))).toContain("accumulation until funded");
  const r = n.config.recipients[0];
  if (r?.mode !== "fixed") throw new Error();
  r.amountStroops = ((1n << 127n) - 1n).toString();
  expect(() => convert(d)).toThrow();
});
it("reports exact resolved owner, both branches and financial/input rules", () => {
  const d = draft(),
    text = conditionalDefinitionEnglish(convert(d));
  for (const expected of [
    OWNER,
    OTHER,
    THIRD,
    "True:",
    "False:",
    "remaining after upstream Pay deductions",
    "Equality follows False",
    "threshold constant",
    "never a per-payment input",
    "not a payer refund",
    "selected-branch",
    "refund",
    "rounds down",
  ])
    expect(text).toContain(expected);
  expect(flowToEnglish(d)).toContain("full address resolved and reviewed before signing");
  expect(conditionalCanvasEnglish(d, { owner: OWNER })).toContain(OWNER);
});
it("checks exactly the required artifact families without inferring activation", () => {
  const d = draft(),
    pins = { ...CONDITIONAL_V2_WASM_HASHES };
  delete (pins as Partial<typeof pins>).SPLITTER;
  expect(conditionalArtifactAvailability(d, pins)).toEqual({ available: true });
  expect(conditionalArtifactAvailability(splitDraft(), pins).available).toBe(false);
  expect(conditionalArtifactAvailability(d, { ...pins, PAYER: "ab".repeat(32) }).available).toBe(
    false,
  );
  expect(conditionalArtifactAvailability(d, {}).available).toBe(false);
});
