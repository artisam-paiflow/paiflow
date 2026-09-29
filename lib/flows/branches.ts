import { formatStroops } from "@/lib/utils";
import type { EdgeBranch, FlowEdge, FlowGraph, FlowNode, LogicNode } from "./schema";

/**
 * Condition kinds with a second, "false" output. Only the amount kinds today:
 * they compile to the router contract, which already carries two paths. Time
 * conditions join this list with #721, once the timelock contract grows a
 * second target list; the graph shape, the handles and the validation read
 * from here and need no other change.
 */
export const BRANCHING_CONDITION_KINDS = ["amount_gt", "amount_lt"] as const;
export type BranchingConditionKind = (typeof BRANCHING_CONDITION_KINDS)[number];
export type BranchingCondition = LogicNode & {
  config: Extract<LogicNode["config"], { kind: BranchingConditionKind }>;
};

export function isBranchingCondition(n: FlowNode | undefined): n is BranchingCondition {
  return (
    n?.type === "condition" &&
    (BRANCHING_CONDITION_KINDS as readonly string[]).includes(n.config.kind)
  );
}

/**
 * The branch an edge leaves its source on, or null when the source is not a
 * condition. An edge out of a condition with no handle is `"true"`: every flow
 * saved before branches existed drew the gated steps that way, and a condition
 * with a single output only has a "met" side.
 */
export function edgeBranch(
  edge: Pick<FlowEdge, "sourceHandle">,
  source: FlowNode | undefined,
): EdgeBranch | null {
  if (source?.type !== "condition") return null;
  return edge.sourceHandle ?? "true";
}

/** How each output is named on the canvas and in validation messages. */
export const BRANCH_LABEL: Record<EdgeBranch, string> = { true: "True", false: "False" };

/**
 * The payments that take a branch, e.g. "more than 5 USDC" or "5 USDC or less".
 * Both kinds are strict (#719), so the threshold itself always goes to false.
 */
export function branchAmountText(
  config: BranchingCondition["config"],
  branch: EdgeBranch,
  assetSuffix = "",
): string {
  const amount = `${formatStroops(config.amountStroops)}${assetSuffix}`;
  if (config.kind === "amount_gt") {
    return branch === "true" ? `more than ${amount}` : `${amount} or less`;
  }
  return branch === "true" ? `less than ${amount}` : `${amount} or more`;
}

export type BranchTargets = Record<EdgeBranch, string[]>;

/**
 * The on-chain next steps on each side of a condition, in edge order. Edges to
 * or from an `email_notify` node are skipped, exactly as `getPipelineChildren`
 * in to-params.ts skips them: those nodes are off-chain decorators and never
 * become a contract's next step.
 */
export function conditionBranchTargets(graph: FlowGraph, conditionId: string): BranchTargets {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const source = byId.get(conditionId);
  const out: BranchTargets = { true: [], false: [] };
  for (const e of graph.edges) {
    if (e.source !== conditionId) continue;
    if (byId.get(e.target)?.type === "email_notify") continue;
    const branch = edgeBranch(e, source);
    if (branch) out[branch].push(e.target);
  }
  return out;
}

/**
 * The router contract takes path A when `amount >= threshold` and path B
 * otherwise (`contracts/conditions/router`). `amount_gt` compiles its threshold
 * one stroop up (`routerThresholdStroops`), so path A is "more than" and its
 * met side; `amount_lt` keeps the threshold, so path B is "less than" and its
 * met side.
 *
 * | kind        | true (met) | false (not met) |
 * | ----------- | ---------- | --------------- |
 * | `amount_gt` | path A     | path B          |
 * | `amount_lt` | path B     | path A          |
 */
export function routerPathBranch(kind: BranchingConditionKind, path: "A" | "B"): EdgeBranch {
  const aIsTrue = kind === "amount_gt";
  return (path === "A") === aIsTrue ? "true" : "false";
}

export function routerPaths(
  kind: BranchingConditionKind,
  targets: BranchTargets,
): { pathANodeIds: string[]; pathBNodeIds: string[] } {
  return {
    pathANodeIds: [...targets[routerPathBranch(kind, "A")]],
    pathBNodeIds: [...targets[routerPathBranch(kind, "B")]],
  };
}
