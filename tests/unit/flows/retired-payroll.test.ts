import { describe, expect, it } from "vitest";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline, flowToParams } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { hasRetiredPayrollInput } from "@/lib/flows/retired-payroll";
import { assertNoHiddenSurfaces, assertPreparedDeploymentAllowed } from "@/lib/features";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const graph = {
  nodes: [
    { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "pay",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: ADDRESS,
        mode: "fixed",
        amountStroops: "10000000",
      },
    },
  ],
  edges: [{ id: "edge", source: "receive", target: "pay" }],
};

describe("permanently retired payroll", () => {
  it.each([
    { type: "payroll" },
    { type: "payroll_dev" },
    { kind: "payroll" },
    { kind: "payroll_dev" },
    { kind: "payroll_trigger" },
    { kind: "payroll_trigger_dev" },
    { templateKind: "PAYROLL" },
    { templateKind: "PAYROLL_DEV" },
  ])(
    "refuses nested retired instructions before unknown fields are stripped: %j",
    (instruction) => {
      const retired = { ...graph, extra: { compiled: [instruction] } };
      expect(hasRetiredPayrollInput(retired)).toBe(true);
      expect(FlowGraphSchema.safeParse(retired).success).toBe(false);
      expect(validateFlow(retired).ok).toBe(false);
      expect(() => flowToPipeline(retired as unknown as FlowGraph)).toThrow(/retired/i);
      expect(() => flowToParams(retired as unknown as FlowGraph, "SPLITTER")).toThrow(/retired/i);
      expect(() => assertPreparedDeploymentAllowed(retired, [], ALL_FEATURES_ON)).toThrow(
        /retired/i,
      );
    },
  );

  it("refuses both legacy pipeline-only and current Subscription payroll preparations", () => {
    const payroll = {
      ...graph,
      nodes: [{ id: "receive", type: "payroll", config: {} }, graph.nodes[1]],
    };
    expect(() =>
      assertPreparedDeploymentAllowed(payroll, [{ templateKind: "SUBSCRIPTION" }], ALL_FEATURES_ON),
    ).toThrow(/retired/i);
    expect(() =>
      assertPreparedDeploymentAllowed(graph, [{ templateKind: "PAYROLL" }], ALL_FEATURES_ON),
    ).toThrow(/retired/i);
    expect(() =>
      assertPreparedDeploymentAllowed(graph, [{ templateKind: "SUBSCRIPTION" }], ALL_FEATURES_ON, [
        { params: { kind: "payroll_trigger" } },
      ]),
    ).toThrow(/retired/i);
    expect(() =>
      assertNoHiddenSurfaces(FlowGraphSchema.parse(graph), ["PAYROLL"], ALL_FEATURES_ON),
    ).toThrow(/retired/i);
  });

  it("preserves ordinary payments and payroll words in labels, names and node IDs", () => {
    const ordinary = {
      ...graph,
      nodes: [
        graph.nodes[0],
        {
          ...graph.nodes[1],
          id: "payroll",
          config: { ...graph.nodes[1]!.config, label: "Payroll" },
        },
      ],
      edges: [{ id: "edge", source: "receive", target: "payroll" }],
      positions: { payroll: { x: 0, y: 0 } },
      name: "Payroll",
    };
    expect(hasRetiredPayrollInput(ordinary)).toBe(false);
    const parsed = FlowGraphSchema.parse(ordinary);
    expect(validateFlow(parsed).ok).toBe(true);
    expect(flowToPipeline(parsed).map((node) => node.templateKind)).toEqual([
      "DEPOSIT_TRIGGER",
      "PAYER",
    ]);
  });

  it("handles cycles, deep nesting and wide arrays without overflowing", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(hasRetiredPayrollInput(cycle)).toBe(false);
    cycle.retired = { kind: "payroll_trigger" };
    expect(hasRetiredPayrollInput(cycle)).toBe(true);
    const wide: unknown[] = Array.from({ length: 150_000 }, () => null);
    wide.push({ type: "payroll" });
    expect(hasRetiredPayrollInput(wide)).toBe(true);
    let deep: unknown = { templateKind: "PAYROLL" };
    for (let i = 0; i < 20_000; i++) deep = { child: deep };
    expect(hasRetiredPayrollInput(deep)).toBe(true);
  });
});
