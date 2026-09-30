/**
 * True/False branches on an amount condition (#720). The router contract takes
 * path A when `amount >= threshold` and path B otherwise
 * (`contracts/conditions/router`); `amount_gt` compiles its threshold one
 * stroop up (#719). The mapping under test:
 *
 * | kind        | True (met) | False (not met) |
 * | ----------- | ---------- | --------------- |
 * | `amount_gt` | path A     | path B          |
 * | `amount_lt` | path B     | path A          |
 *
 * `routeOnChain` below restates the router's comparison so the boundary tests
 * pin which branch a given amount actually reaches, not only which ids sit in
 * which path.
 */
import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { FlowEdgeSchema, FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import {
  conditionBranchTargets,
  edgeBranch,
  isBranchingCondition,
  routerPathBranch,
} from "@/lib/flows/branches";
import { flowToPipeline, type PipelineNode, type RouterNodeParams } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import { PatchOpSchema } from "@/lib/ai/prompts";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" } as const;
const T = 50_000_000n; // 5 USDC

type Edge = { id: string; source: string; target: string; sourceHandle?: string };
type CondConfig =
  | { kind: "amount_gt"; amountStroops: string }
  | { kind: "amount_lt"; amountStroops: string }
  | { kind: "time_after"; at: string }
  | { kind: "multisig"; signers: string[]; threshold: number };

const trigger = { id: "t", type: "on_receive", config: { asset: USDC } };
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

function graph(config: CondConfig, edges: Edge[], extra: object[] = []): unknown {
  return {
    nodes: [trigger, { id: "c", type: "condition", config }, pay, split, ...extra],
    edges: [{ id: "e0", source: "t", target: "c" }, ...edges],
  };
}

const gt = { kind: "amount_gt", amountStroops: T.toString() } as const;
const lt = { kind: "amount_lt", amountStroops: T.toString() } as const;

/** True → pay, False → split. */
function wired(config: CondConfig): unknown {
  return graph(config, [
    { id: "e1", source: "c", target: "p", sourceHandle: "true" },
    { id: "e2", source: "c", target: "s", sourceHandle: "false" },
  ]);
}

function parse(raw: unknown): FlowGraph {
  return FlowGraphSchema.parse(raw);
}

function routerOf(nodes: PipelineNode[]): RouterNodeParams {
  const router = nodes.find((n) => n.templateKind === TemplateKind.ROUTER);
  if (!router || router.params.kind !== "router") throw new Error("no router in pipeline");
  return router.params;
}

/** `execute_step` in contracts/conditions/router: `amount >= threshold ? PathA : PathB`. */
function routeOnChain(router: RouterNodeParams, amount: bigint): string[] {
  return amount >= BigInt(router.threshold) ? router.pathANodeIds : router.pathBNodeIds;
}

function codes(raw: unknown): string[] {
  const r = validateFlow(raw);
  return r.ok ? [] : r.errors.map((e) => e.code ?? e.message);
}

describe("schema: edge sourceHandle", () => {
  it("accepts true, false, or nothing", () => {
    for (const sourceHandle of ["true", "false", undefined]) {
      expect(
        FlowEdgeSchema.safeParse({ id: "e", source: "a", target: "b", sourceHandle }).success,
      ).toBe(true);
    }
  });

  it.each([["maybe"], ["TRUE"], [null], [true], [1], [""]])(
    "refuses %j as a branch",
    (sourceHandle) => {
      expect(
        FlowEdgeSchema.safeParse({ id: "e", source: "a", target: "b", sourceHandle }).success,
      ).toBe(false);
    },
  );

  it("keeps the branch through a graph parse", () => {
    const g = parse(wired(gt));
    expect(g.edges.map((e) => e.sourceHandle)).toEqual([undefined, "true", "false"]);
  });
});

describe("edgeBranch: the legacy rule", () => {
  const g = parse(graph(gt, [{ id: "e1", source: "c", target: "p" }]));
  const cond = g.nodes.find((n) => n.id === "c");

  it("reads a handle-less edge out of a condition as True", () => {
    expect(edgeBranch({}, cond)).toBe("true");
    expect(conditionBranchTargets(g, "c")).toEqual({ true: ["p"], false: [] });
  });

  it("gives an edge out of anything but a condition no branch", () => {
    expect(edgeBranch({ sourceHandle: "false" }, g.nodes[0])).toBeNull();
  });

  it("amount and time conditions branch; oracle and multisig do not", () => {
    expect(isBranchingCondition(cond)).toBe(true);
    for (const config of [
      { kind: "time_after", at: "2030-01-01T00:00:00.000Z" },
      { kind: "time_before", at: "2030-01-01T00:00:00.000Z" },
    ] as const) {
      expect(isBranchingCondition({ id: "x", type: "condition", config })).toBe(true);
    }
    expect(
      isBranchingCondition({
        id: "x",
        type: "condition",
        config: { kind: "multisig", signers: [ADDR_A], threshold: 1 },
      }),
    ).toBe(false);
  });
});

describe("flowToPipeline: branches onto router paths", () => {
  it("amount_gt: True is path A, False is path B, and both steps deploy", () => {
    const pipeline = flowToPipeline(parse(wired(gt)));
    const router = routerOf(pipeline);
    expect(router.threshold).toBe((T + 1n).toString());
    expect(router.pathANodeIds).toEqual(["p"]);
    expect(router.pathBNodeIds).toEqual(["s"]);
    expect(pipeline.map((n) => n.nodeId).sort()).toEqual(["c", "p", "s", "t"]);
  });

  it("amount_lt: True is path B, False is path A", () => {
    const router = routerOf(flowToPipeline(parse(wired(lt))));
    expect(router.threshold).toBe(T.toString());
    expect(router.pathANodeIds).toEqual(["s"]);
    expect(router.pathBNodeIds).toEqual(["p"]);
  });

  it("amount_gt boundary: T goes False, T+1 goes True", () => {
    const router = routerOf(flowToPipeline(parse(wired(gt))));
    expect(routeOnChain(router, T - 1n)).toEqual(["s"]);
    expect(routeOnChain(router, T)).toEqual(["s"]);
    expect(routeOnChain(router, T + 1n)).toEqual(["p"]);
  });

  it("amount_lt boundary: T goes False, T-1 goes True", () => {
    const router = routerOf(flowToPipeline(parse(wired(lt))));
    expect(routeOnChain(router, T + 1n)).toEqual(["s"]);
    expect(routeOnChain(router, T)).toEqual(["s"]);
    expect(routeOnChain(router, T - 1n)).toEqual(["p"]);
  });

  it("the mapping table matches for both kinds", () => {
    expect(routerPathBranch("amount_gt", "A")).toBe("true");
    expect(routerPathBranch("amount_gt", "B")).toBe("false");
    expect(routerPathBranch("amount_lt", "A")).toBe("false");
    expect(routerPathBranch("amount_lt", "B")).toBe("true");
  });

  it("reads a legacy handle-less edge as True next to an explicit False", () => {
    const g = graph(gt, [
      { id: "e2", source: "c", target: "s", sourceHandle: "false" },
      { id: "e1", source: "c", target: "p" },
    ]);
    const router = routerOf(flowToPipeline(parse(g)));
    expect(router.pathANodeIds).toEqual(["p"]);
    expect(router.pathBNodeIds).toEqual(["s"]);
  });

  it("deploys the False side even when the trigger reaches it first", () => {
    // Swap the ids' roles: split on True, pay on False. The action loop starts
    // from the first action in flow order; the other side must still deploy.
    const g = graph(gt, [
      { id: "e1", source: "c", target: "s", sourceHandle: "true" },
      { id: "e2", source: "c", target: "p", sourceHandle: "false" },
    ]);
    const pipeline = flowToPipeline(parse(g));
    expect(pipeline.map((n) => n.nodeId).sort()).toEqual(["c", "p", "s", "t"]);
    const router = routerOf(pipeline);
    expect(router.pathANodeIds).toEqual(["s"]);
    expect(router.pathBNodeIds).toEqual(["p"]);
  });
});

describe("validateFlow: branches", () => {
  it("passes an amount_gt with both branches wired", () => {
    const r = validateFlow(wired(gt));
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (r.ok) {
      expect(r.pipeline).toContain(TemplateKind.ROUTER);
      expect(r.pipeline).toContain(TemplateKind.SPLITTER);
    }
  });

  it("passes an amount_lt with both branches wired", () => {
    const r = validateFlow(wired(lt));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("refuses a missing True branch and names it", () => {
    const r = validateFlow(
      graph(gt, [
        { id: "e2", source: "c", target: "s", sourceHandle: "false" },
        { id: "e3", source: "t", target: "p" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issue?.nodeId).toBe("c");
    expect(issue?.friendlyMessage).toContain(
      "A payment of more than 5 USDC meets this amount condition, but nothing is connected to the condition's True output",
    );
    expect(issue?.friendlyMessage).toContain("Connect a step to the True output");
  });

  it("refuses a missing True branch on amount_lt, naming the amounts below", () => {
    const r = validateFlow(
      graph(lt, [
        { id: "e2", source: "c", target: "s", sourceHandle: "false" },
        { id: "e3", source: "t", target: "p" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "ROUTER_EMPTY_PATH");
    expect(issue?.friendlyMessage).toContain("A payment of less than 5 USDC meets");
  });

  it("accepts the same step on both branches: the condition is its parent either way", () => {
    const r = validateFlow(
      graph(gt, [
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "p", sourceHandle: "false" },
        { id: "e3", source: "t", target: "s" },
      ]),
    );
    // The split hanging off the trigger is unrelated noise; only branch rules
    // and the router's paths matter here.
    const found = r.ok ? [] : r.errors.map((e) => e.code);
    expect(found).not.toContain("ROUTER_EMPTY_PATH");
    expect(found).not.toContain("BRANCH_MERGE");
    expect(found).not.toContain("BRANCH_FAN_OUT");
  });

  it("refuses two steps on one branch: the router sends the whole amount to each", () => {
    const pay2 = { ...pay, id: "p2" };
    const r = validateFlow(
      graph(
        gt,
        [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e1b", source: "c", target: "p2", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
        ],
        [pay2],
      ),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_FAN_OUT");
    expect(issue?.nodeId).toBe("c");
    expect(issue?.friendlyMessage).toContain("True output of this amount condition connects to 2");
  });

  it("refuses two handle-less (legacy True) edges as a fan-out too", () => {
    expect(
      codes(
        graph(gt, [
          { id: "e1", source: "c", target: "p" },
          { id: "e2", source: "c", target: "s" },
        ]),
      ),
    ).toContain("BRANCH_FAN_OUT");
  });

  it("refuses a step reached from both sides through different parents", () => {
    // True → pay → split, False → split: the split's contract stores one parent.
    expect(
      codes(
        graph(gt, [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "p", target: "s" },
        ]),
      ),
    ).toContain("BRANCH_MERGE");
  });

  it("refuses a cycle through a branch", () => {
    const r = validateFlow(
      graph(gt, [
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "s", sourceHandle: "false" },
        { id: "e3", source: "s", target: "c" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.message)).toContain("Flow contains a cycle");
  });

  it("refuses a False branch on a multisig condition, which has one output", () => {
    const r = validateFlow(
      graph({ kind: "multisig", signers: [ADDR_A, ADDR_B], threshold: 1 }, [
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "s", sourceHandle: "false" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_NOT_SUPPORTED");
    expect(issue?.nodeId).toBe("c");
    expect(issue?.friendlyMessage).toContain("Only amount and time conditions have a False output");
  });

  it("accepts an explicit True edge on a multisig condition, its one output", () => {
    const r = validateFlow({
      nodes: [
        trigger,
        {
          id: "c",
          type: "condition",
          config: { kind: "multisig", signers: [ADDR_A, ADDR_B], threshold: 1 },
        },
        pay,
      ],
      edges: [
        { id: "e0", source: "t", target: "c" },
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
      ],
    });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("refuses a branch handle on an edge out of a non-condition", () => {
    const r = validateFlow({
      nodes: [trigger, pay],
      edges: [{ id: "e0", source: "t", target: "p", sourceHandle: "false" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_NOT_SUPPORTED");
    expect(issue?.nodeId).toBe("t");
  });

  it("refuses an email notification hanging off an amount condition", () => {
    const email = {
      id: "m",
      type: "email_notify",
      config: { recipients: [{ address: ADDR_A, email: "a@example.com" }], subject: "Hi" },
    };
    expect(
      codes(
        graph(
          gt,
          [
            { id: "e1", source: "c", target: "p", sourceHandle: "true" },
            { id: "e2", source: "c", target: "s", sourceHandle: "false" },
            { id: "e3", source: "c", target: "m", sourceHandle: "false" },
          ],
          [email],
        ),
      ),
    ).toContain("BRANCH_EMAIL");
  });
});

describe("flowToEnglish: both branches", () => {
  it("describes amount_gt as 'if more than …; otherwise, …'", () => {
    const out = flowToEnglish(parse(wired(gt)));
    expect(out).toContain(
      "When this contract receives USDC: if the amount is more than 5 USDC, pay",
    );
    expect(out).toContain("; otherwise, split USDC");
  });

  it("describes amount_lt as 'if less than …; otherwise, …'", () => {
    const out = flowToEnglish(parse(wired(lt)));
    expect(out).toContain("if the amount is less than 5 USDC, pay");
    expect(out).toContain("; otherwise, split USDC");
  });

  it("says which output is still empty", () => {
    const out = flowToEnglish(
      parse(
        graph(gt, [
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "t", target: "p" },
        ]),
      ),
    );
    expect(out).toContain(
      "if the amount is more than 5 USDC, nothing is connected yet (connect a step to the True output); otherwise, split USDC",
    );
  });
});

describe("AI assistant: branches survive its edge paths", () => {
  it("the patch schema carries a branch and refuses a bad one", () => {
    const ok = PatchOpSchema.safeParse({
      op: "addEdge",
      edge: { id: "e", source: "c", target: "s", sourceHandle: "false" },
    });
    expect(ok.success && ok.data.op === "addEdge" && ok.data.edge.sourceHandle).toBe("false");
    expect(
      PatchOpSchema.safeParse({
        op: "addEdge",
        edge: { id: "e", source: "c", target: "s", sourceHandle: "else" },
      }).success,
    ).toBe(false);
  });

  it("normalizeFlowGraph keeps a False branch rather than turning it True", () => {
    // Two pays: the normalizer rebuilds split recipients its own way, which is
    // beside the point here.
    const r = normalizeFlowGraph({
      nodes: [trigger, { id: "c", type: "condition", config: gt }, pay, { ...pay, id: "p2" }],
      edges: [
        { id: "e0", source: "t", target: "c" },
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "p2", sourceHandle: "false" },
      ],
    });
    expect(r.ok ? "ok" : r).toBe("ok");
    if (!r.ok) return;
    expect(r.graph.edges.find((e) => e.id === "e2")?.sourceHandle).toBe("false");
  });
});
