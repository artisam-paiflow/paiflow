import { describe, expect, it } from "vitest";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import { timelockSideBranch } from "@/lib/flows/branches";

const OWNER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const AT = "2030-06-01T00:00:00.000Z";
function locked(kind: "time_before" | "time_after", devMode = false): FlowGraph {
  return FlowGraphSchema.parse({
    devMode,
    nodes: [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      { id: "c", type: "condition", config: { kind, at: AT } },
      { id: "h", type: "hold", config: {} },
      { id: "r", type: "return_to_owner", config: {} },
    ],
    edges: [
      { id: "tc", source: "t", target: "c" },
      { id: "ch", source: "c", target: "h", sourceHandle: timelockSideBranch(kind, "before") },
      { id: "cr", source: "c", target: "r", sourceHandle: timelockSideBranch(kind, "after") },
    ],
  });
}
function prepare(g: FlowGraph) {
  return flowToPipeline(g, undefined, undefined, { ownerAddress: OWNER });
}

describe("terminal outcomes", () => {
  it.each(["time_before", "time_after"] as const)(
    "%s absorbs Hold and preserves the condition ID",
    (kind) => {
      const g = locked(kind);
      const v = validateFlow(g);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.graph).toEqual(g);
        expect(v.pendingLabels).toEqual([]);
      }
      const p = prepare(g);
      expect(p.map((n) => n.nodeId)).toEqual(["t", "c", "r"]);
      expect(p[1]).toMatchObject({
        nodeId: "c",
        templateKind: "TIMELOCK",
        params: { kind: "timelock", mode: "after", nextStepNodeIds: ["r"], unlockTime: 1906502400 },
      });
      expect(p[2]).toMatchObject({
        templateKind: "PAYER",
        params: {
          kind: "payer",
          mode: "percentage",
          percentageBps: 10000,
          recipient: OWNER,
          nextStepNodeIds: [],
        },
      });
      expect(g.nodes.find((n) => n.id === "r")?.config).toEqual({});
      expect(flowToEnglish(g)).toMatch(
        /strictly locked.*no early release.*At or after.*deploying wallet/,
      );
    },
  );
  it("supports the implicit True branch on time_before", () => {
    const g = locked("time_before");
    delete g.edges[1]!.sourceHandle;
    expect(validateFlow(g).ok).toBe(true);
    expect(prepare(g)[1]?.templateKind).toBe("TIMELOCK");
  });
  it("requires a real deploying wallet for compilation", () => {
    const g = locked("time_after");
    expect(() => flowToPipeline(g)).toThrow(/deploying wallet/);
    expect(() =>
      flowToPipeline(g, undefined, undefined, { ownerAddress: "PENDING:owner" }),
    ).toThrow(/deploying wallet/);
  });
  it("stays immutable in dev mode", () => {
    expect(prepare(locked("time_after", true))[2]?.templateKind).toBe("PAYER");
  });
  it("refuses saved owner addresses", () => {
    const g = locked("time_after");
    expect(
      FlowGraphSchema.safeParse({
        ...g,
        nodes: g.nodes.map((n) => (n.id === "r" ? { ...n, config: { recipient: OWNER } } : n)),
      }).success,
    ).toBe(false);
  });
  it.each(["amount_gt", "amount_lt", "multisig"] as const)(
    "supports Return-only branches after %s",
    (kind) => {
      const g = locked("time_after");
      g.nodes = g.nodes.filter((n) => n.id !== "h");
      g.nodes[1] = {
        id: "c",
        type: "condition",
        config:
          kind === "multisig"
            ? { kind, signers: [OWNER], threshold: 1 }
            : { kind, amountStroops: "100" },
      };
      g.edges = g.edges.filter((e) => e.target !== "h");
      g.edges[1]!.sourceHandle = "true";
      if (kind !== "multisig") {
        g.nodes.push({ id: "r2", type: "return_to_owner", config: {} });
        g.edges.push({ id: "cr2", source: "c", target: "r2", sourceHandle: "false" });
      }
      expect(validateFlow(g).ok).toBe(true);
      expect(prepare(g).filter((n) => n.templateKind === "PAYER")).toHaveLength(
        kind === "multisig" ? 1 : 2,
      );
    },
  );
  it("preserves ordinary time branches with Return on both sides", () => {
    const g = locked("time_before");
    g.nodes[2] = { id: "h", type: "return_to_owner", config: {} };
    expect(validateFlow(g).ok).toBe(true);
    expect(prepare(g)[1]).toMatchObject({
      templateKind: "TIMELOCK_BRANCH",
      params: { beforeNodeIds: ["h"], afterNodeIds: ["r"] },
    });
  });
  it.each([
    "wrong side",
    "wrong condition",
    "trigger parent",
    "outgoing Hold",
    "outgoing Return",
    "two inputs",
    "missing after",
  ])("refuses %s", (bad) => {
    const g = locked("time_after");
    if (bad === "wrong side") g.edges[1]!.sourceHandle = "true";
    if (bad === "wrong condition")
      g.nodes[1] = {
        id: "c",
        type: "condition",
        config: { kind: "amount_gt", amountStroops: "100" },
      };
    if (bad === "trigger parent") g.edges[1]!.source = "t";
    if (bad === "outgoing Hold") g.edges.push({ id: "bad", source: "h", target: "r" });
    if (bad === "outgoing Return") g.edges.push({ id: "bad", source: "r", target: "h" });
    if (bad === "two inputs")
      g.edges.push({ id: "bad", source: "c", target: "r", sourceHandle: "false" });
    if (bad === "missing after") {
      g.nodes = g.nodes.filter((n) => n.id !== "r");
      g.edges = g.edges.filter((e) => e.target !== "r");
    }
    expect(validateFlow(g).ok).toBe(false);
  });
  it("refuses oracle full-balance returns before compiling", () => {
    const g = locked("time_after");
    g.nodes = g.nodes.filter((n) => n.id !== "h");
    g.edges = g.edges.filter((e) => e.target !== "h");
    g.nodes[1] = {
      id: "c",
      type: "condition",
      config: { kind: "oracle_gte", oracle: OWNER, key: "price", threshold: "1" },
    };
    const v = validateFlow(g);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]?.message).toMatch(/fixed amount/);
    expect(() => prepare(g)).toThrow(/fixed amount/);
  });
  it("AI normalization keeps terminal markers", () => {
    const g = locked("time_before");
    const result = normalizeFlowGraph(g);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.graph?.nodes.filter((n) => n.type === "hold" || n.type === "return_to_owner"),
    ).toHaveLength(2);
  });
});
