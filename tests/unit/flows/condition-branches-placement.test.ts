/**
 * Where an amount condition with branches may sit, and how the AI assistant's
 * edge paths treat the branch handle (#720, review follow-ups). The mapping
 * and the core rules live in `condition-branches.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { conditionBranchTargets } from "@/lib/flows/branches";
import { validateFlow } from "@/lib/flows/validate";
import { applyPatch, normalizeFlowGraph } from "@/lib/ai/normalize";
import { PatchOpSchema } from "@/lib/ai/prompts";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" } as const;
const gt = { kind: "amount_gt", amountStroops: "50000000" } as const;

type Edge = { id: string; source: string; target: string; sourceHandle?: string };

const trigger = { id: "t", type: "on_receive", config: { asset: USDC } };
const cond = { id: "c", type: "condition", config: gt };
const pay = {
  id: "p",
  type: "pay",
  config: { asset: USDC, recipient: ADDR_A, mode: "fixed", fullAmount: true },
};
const split = {
  id: "s",
  type: "split",
  config: { asset: USDC, recipients: [{ address: ADDR_B, mode: "percentage", bps: 10_000 }] },
};

function graph(edges: Edge[], extra: object[] = []): unknown {
  return {
    nodes: [trigger, cond, pay, split, ...extra],
    edges: [{ id: "e0", source: "t", target: "c" }, ...edges],
  };
}

function codes(raw: unknown): string[] {
  const r = validateFlow(raw);
  return r.ok ? [] : r.errors.map((e) => e.code ?? e.message);
}

describe("validateFlow: where an amount condition may sit", () => {
  it.each([
    [
      "on_schedule",
      { intervalAmount: 1, intervalUnit: "day", startsAt: "2030-01-01T00:00:00.000Z" },
    ],
    ["subscription", { asset: USDC, subscriber: ADDR_A, amountPerPeriodStroops: "100" }],
  ])("refuses one under a %s trigger, which never compiles the router", (type, config) => {
    const r = validateFlow({
      nodes: [{ id: "t", type, config }, cond, pay],
      edges: [
        { id: "e0", source: "t", target: "c" },
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_TRIGGER");
    expect(issue?.nodeId).toBe("c");
    expect(issue?.friendlyMessage).toContain("every payment would go out");
  });

  it("refuses another condition as a branch's direct next step", () => {
    const time = {
      id: "c2",
      type: "condition",
      config: { kind: "time_after", at: "2030-06-01T00:00:00.000Z" },
    };
    expect(
      codes(
        graph(
          [
            { id: "e1", source: "c", target: "c2", sourceHandle: "true" },
            { id: "e2", source: "c2", target: "p" },
            { id: "e3", source: "c", target: "s", sourceHandle: "false" },
          ],
          [time],
        ),
      ),
    ).toContain("BRANCH_TARGET");
  });

  it("passes a chain on one side (True → pay → split)", () => {
    const r = validateFlow(
      graph(
        [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "p", target: "s2" },
        ],
        [{ ...split, id: "s2" }],
      ),
    );
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});

describe("AI assistant: the branch handle on its edge paths", () => {
  it("reads a null sourceHandle in a patch as no handle (True), not a parse failure", () => {
    const r = PatchOpSchema.safeParse({
      op: "addEdge",
      edge: { id: "e", source: "c", target: "s", sourceHandle: null },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.op === "addEdge") expect(r.data.edge.sourceHandle).toBeUndefined();
  });

  it("applyPatch carries a False branch into the graph", () => {
    const base = FlowGraphSchema.parse(
      graph([{ id: "e1", source: "c", target: "p", sourceHandle: "true" }]),
    );
    const op = PatchOpSchema.parse({
      op: "addEdge",
      edge: { id: "e2", source: "c", target: "s", sourceHandle: "false" },
    });
    const next = applyPatch(base, [op]);
    expect(conditionBranchTargets(next, "c")).toEqual({ true: ["p"], false: ["s"] });
  });

  it("normalizeFlowGraph drops a handle on an edge that doesn't leave a condition", () => {
    const r = normalizeFlowGraph({
      nodes: [trigger, pay],
      edges: [{ id: "e0", source: "t", target: "p", sourceHandle: "false" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.graph.edges[0]?.sourceHandle).toBeUndefined();
  });
});
