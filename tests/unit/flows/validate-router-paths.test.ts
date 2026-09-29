/**
 * An amount condition compiles to the router contract, which forwards the whole
 * amount down path A (`amount >= threshold`) or path B (otherwise). A path with
 * no step is a silent no-op on chain and the router has no withdraw, so money
 * routed there is lost (#719). validateFlow refuses any router the pipeline
 * would deploy with an empty path. The graph only fills one side today, so
 * every amount condition is refused; once conditions carry true/false branches
 * (#720) the same rule fires only on a missing branch.
 *
 * `amount_gt` must also be strict. The router's comparison is `>=`, so the
 * pipeline feeds it threshold + 1 stroop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateKind } from "@prisma/client";
import type { PipelineNode } from "@/lib/flows/to-params";

// Lets a test stand in for the two-branch pipeline #720 will produce, without
// a graph shape that can express it yet.
const pipelineOverride = vi.hoisted(() => ({
  transform: null as ((nodes: PipelineNode[]) => PipelineNode[]) | null,
}));

vi.mock("@/lib/flows/to-params", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/flows/to-params")>();
  return {
    ...mod,
    flowToPipeline: (...args: Parameters<typeof mod.flowToPipeline>) => {
      const out = mod.flowToPipeline(...args);
      return pipelineOverride.transform ? pipelineOverride.transform(out) : out;
    },
  };
});

const { validateFlow } = await import("@/lib/flows/validate");
const { flowToPipeline, routerThresholdStroops } = await import("@/lib/flows/to-params");
const { flowToEnglish } = await import("@/lib/flows/english");

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" } as const;

type ConditionConfig =
  | { kind: "amount_gt"; amountStroops: string }
  | { kind: "amount_lt"; amountStroops: string }
  | { kind: "time_after"; at: string };

function conditionFlow(config: ConditionConfig) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      { id: "c", type: "condition", config },
      {
        id: "a",
        type: "split",
        config: {
          asset: USDC,
          recipients: [
            { address: ADDR_A, bps: 5000 },
            { address: ADDR_B, bps: 5000 },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "t", target: "c" },
      { id: "e2", source: "c", target: "a" },
    ],
  };
}

function routerOf(nodes: PipelineNode[]) {
  const router = nodes.find((n) => n.templateKind === TemplateKind.ROUTER);
  if (!router || router.params.kind !== "router") throw new Error("no router in pipeline");
  return router.params;
}

beforeEach(() => {
  pipelineOverride.transform = null;
});

describe("validateFlow: a router path with nothing on it", () => {
  it("refuses amount_gt, naming the amounts that would be stranded", () => {
    const r = validateFlow(conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issue).toMatchObject({ path: "nodes.c", nodeId: "c" });
    expect(issue?.friendlyMessage).toContain("A payment of 5 USDC or less");
    expect(issue?.friendlyMessage).toContain("stuck in the contract");
    expect(issue?.friendlyMessage).toContain("remove the condition or use a time condition");
  });

  it("refuses amount_lt, where the unmatched side is the threshold and above", () => {
    const r = validateFlow(conditionFlow({ kind: "amount_lt", amountStroops: "50000000" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issue).toMatchObject({ path: "nodes.c", nodeId: "c" });
    expect(issue?.friendlyMessage).toContain("A payment of 5 USDC or more");
  });

  it("leaves a time condition alone, which compiles to a timelock, not a router", () => {
    const r = validateFlow(conditionFlow({ kind: "time_after", at: "2030-06-01T00:00:00.000Z" }));
    expect(r.ok).toBe(true);
  });

  it("accepts a router once both paths carry a step", () => {
    // Both sides point at the one split: not a shape the graph can draw, but
    // the pipeline #720 produces has the same property this rule reads.
    pipelineOverride.transform = (nodes) =>
      nodes.map((n) =>
        n.params.kind === "router"
          ? { ...n, params: { ...n.params, pathANodeIds: ["a"], pathBNodeIds: ["a"] } }
          : n,
      );
    const r = validateFlow(conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.ROUTER,
        TemplateKind.SPLITTER,
      ]);
    }
  });

  it("still refuses when only path A is empty", () => {
    pipelineOverride.transform = (nodes) =>
      nodes.map((n) =>
        n.params.kind === "router"
          ? { ...n, params: { ...n.params, pathANodeIds: [], pathBNodeIds: ["a"] } }
          : n,
      );
    const r = validateFlow(conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toContain("ROUTER_EMPTY_PATH");
    }
  });
});

describe("flowToPipeline: router threshold", () => {
  it("compiles amount_gt one stroop higher, so an equal amount does not match", () => {
    const router = routerOf(
      flowToPipeline(
        conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }) as Parameters<
          typeof flowToPipeline
        >[0],
      ),
    );
    expect(router.threshold).toBe("50000001");
    expect(router.pathANodeIds).toEqual(["a"]);
    expect(router.pathBNodeIds).toEqual([]);
  });

  it("keeps amount_lt's threshold as entered: path B is already strict", () => {
    const router = routerOf(
      flowToPipeline(
        conditionFlow({ kind: "amount_lt", amountStroops: "50000000" }) as Parameters<
          typeof flowToPipeline
        >[0],
      ),
    );
    expect(router.threshold).toBe("50000000");
    expect(router.pathANodeIds).toEqual([]);
    expect(router.pathBNodeIds).toEqual(["a"]);
  });

  it("adds the stroop in bigint, without losing precision past 2^53", () => {
    expect(routerThresholdStroops({ kind: "amount_gt", amountStroops: "9007199254740993" })).toBe(
      "9007199254740994",
    );
    expect(routerThresholdStroops({ kind: "amount_gt", amountStroops: "0" })).toBe("1");
    expect(routerThresholdStroops({ kind: "amount_lt", amountStroops: "9007199254740993" })).toBe(
      "9007199254740993",
    );
  });
});

describe("flowToEnglish: amount conditions read as strict", () => {
  it("says 'more than' for amount_gt", () => {
    const out = flowToEnglish(
      conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }) as Parameters<
        typeof flowToEnglish
      >[0],
    );
    expect(out).toContain("only if the amount is more than 5 USDC");
  });

  it("says 'less than' for amount_lt", () => {
    const out = flowToEnglish(
      conditionFlow({ kind: "amount_lt", amountStroops: "50000000" }) as Parameters<
        typeof flowToEnglish
      >[0],
    );
    expect(out).toContain("only if the amount is less than 5 USDC");
  });
});
