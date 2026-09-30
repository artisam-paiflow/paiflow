/**
 * An amount condition compiles to the router contract, which forwards the whole
 * amount down path A (`amount >= threshold`) or path B (otherwise). A path with
 * no step is a silent no-op on chain and the router has no withdraw, so money
 * routed there is lost (#719). validateFlow refuses any router the pipeline
 * would deploy with an empty path. The paths come from the condition's
 * True/False branches (#720), so the rule now fires on a missing branch, and
 * names it. `condition-branches.test.ts` covers the wired-up cases.
 *
 * `amount_gt` must also be strict. The router's comparison is `>=`, so the
 * pipeline feeds it threshold + 1 stroop.
 */
import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline, routerThresholdStroops, type PipelineNode } from "@/lib/flows/to-params";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" } as const;

type ConditionConfig =
  | { kind: "amount_gt"; amountStroops: string }
  | { kind: "amount_lt"; amountStroops: string }
  | { kind: "time_after"; at: string };

/** A pre-#720 flow: one handle-less edge out of the condition, read as True. */
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

describe("validateFlow: a router path with nothing on it", () => {
  it("refuses amount_gt with no False branch, naming the amounts and the output", () => {
    const r = validateFlow(conditionFlow({ kind: "amount_gt", amountStroops: "50000000" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issues = r.errors.filter((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "nodes.c", nodeId: "c" });
    expect(issues[0]?.friendlyMessage).toContain("A payment of 5 USDC or less doesn't meet");
    expect(issues[0]?.friendlyMessage).toContain("stuck in the contract");
    expect(issues[0]?.friendlyMessage).toContain("Connect a step to the False output");
    expect(issues[0]?.friendlyMessage).not.toContain("can't draw");
  });

  it("refuses amount_lt with no False branch, where the unmatched side is the threshold and above", () => {
    const r = validateFlow(conditionFlow({ kind: "amount_lt", amountStroops: "50000000" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issue).toMatchObject({ path: "nodes.c", nodeId: "c" });
    expect(issue?.friendlyMessage).toContain("A payment of 5 USDC or more doesn't meet");
    expect(issue?.friendlyMessage).toContain("False output");
  });

  it("reports a time condition's empty side as a timelock one, not a router path", () => {
    const r = validateFlow(conditionFlow({ kind: "time_after", at: "2030-06-01T00:00:00.000Z" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toEqual(["TIMELOCK_EMPTY_SIDE"]);
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
