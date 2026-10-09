import { formatStroops } from "@/lib/utils";
import { formatDeadline } from "./format-time";
import type { EdgeBranch, FlowEdge, FlowGraph, FlowNode, LogicNode } from "./schema";

/**
 * Condition kinds with a second, "false" output. The amount kinds compile to
 * the router contract, which already carries two paths (#720). The time kinds
 * compile to the timelock_branch contract, which holds the funds and pays one
 * of two next steps depending on when it is released (#721). The graph shape,
 * the handles and the validation read from here.
 */
export const AMOUNT_CONDITION_KINDS = ["amount_gt", "amount_lt"] as const;
export const TIME_CONDITION_KINDS = ["time_after", "time_before"] as const;
export const BRANCHING_CONDITION_KINDS = [
  ...AMOUNT_CONDITION_KINDS,
  ...TIME_CONDITION_KINDS,
] as const;
export type AmountConditionKind = (typeof AMOUNT_CONDITION_KINDS)[number];
export type TimeConditionKind = (typeof TIME_CONDITION_KINDS)[number];
export type BranchingConditionKind = (typeof BRANCHING_CONDITION_KINDS)[number];
export type AmountCondition = LogicNode & {
  config: Extract<LogicNode["config"], { kind: AmountConditionKind }>;
};
export type TimeCondition = LogicNode & {
  config: Extract<LogicNode["config"], { kind: TimeConditionKind }>;
};
export type BranchingCondition = AmountCondition | TimeCondition;

export function isAmountCondition(n: FlowNode | undefined): n is AmountCondition {
  return (
    n?.type === "condition" && (AMOUNT_CONDITION_KINDS as readonly string[]).includes(n.config.kind)
  );
}

export function isTimeCondition(n: FlowNode | undefined): n is TimeCondition {
  return (
    n?.type === "condition" && (TIME_CONDITION_KINDS as readonly string[]).includes(n.config.kind)
  );
}

export function isBranchingCondition(n: FlowNode | undefined): n is BranchingCondition {
  return isAmountCondition(n) || isTimeCondition(n);
}

/** What a branching condition tests, for messages. */
export type BranchingNoun = "amount" | "time";

export function branchingNoun(kind: BranchingConditionKind): BranchingNoun {
  return (AMOUNT_CONDITION_KINDS as readonly string[]).includes(kind) ? "amount" : "time";
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
  config: AmountCondition["config"],
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
export function routerPathBranch(kind: AmountConditionKind, path: "A" | "B"): EdgeBranch {
  const aIsTrue = kind === "amount_gt";
  return (path === "A") === aIsTrue ? "true" : "false";
}

export function routerPaths(
  kind: AmountConditionKind,
  targets: BranchTargets,
): { pathANodeIds: string[]; pathBNodeIds: string[] } {
  return {
    pathANodeIds: [...targets[routerPathBranch(kind, "A")]],
    pathBNodeIds: [...targets[routerPathBranch(kind, "B")]],
  };
}

/** The two next-step lists of the timelock_branch contract. */
export type TimelockSide = "before" | "after";

/**
 * The timelock_branch contract pays its "before" list when it is released
 * strictly before `unlock_time` and its "after" list at or after it. A time
 * condition's True output is the side its test names: `time_before` is met
 * before the deadline, `time_after` at or after it.
 *
 * | kind          | true (met)  | false (not met) |
 * | ------------- | ----------- | --------------- |
 * | `time_before` | before list | after list      |
 * | `time_after`  | after list  | before list     |
 *
 * At the deadline itself the contract is on the "after" side, so `time_before`
 * is strict and `time_after` inclusive, the same way the amount kinds are strict.
 */
export function timelockSideBranch(kind: TimeConditionKind, side: TimelockSide): EdgeBranch {
  const beforeIsTrue = kind === "time_before";
  return (side === "before") === beforeIsTrue ? "true" : "false";
}

export function timelockLists(
  kind: TimeConditionKind,
  targets: BranchTargets,
): { beforeNodeIds: string[]; afterNodeIds: string[] } {
  return {
    beforeNodeIds: [...targets[timelockSideBranch(kind, "before")]],
    afterNodeIds: [...targets[timelockSideBranch(kind, "after")]],
  };
}

/**
 * When a branch of a time condition runs, e.g. "before June 25, 2026 at 1:25 PM
 * (UTC)" or "at or after June 25, 2026 at 1:25 PM (UTC)".
 */
export function branchTimeText(config: TimeCondition["config"], branch: EdgeBranch): string {
  const at = formatDeadline(config.at, config.timeZone);
  return timelockSideBranch(config.kind, "before") === branch
    ? `before ${at}`
    : `at or after ${at}`;
}

/** The test one output stands for, for any branching kind. */
export function branchTestText(
  cond: BranchingCondition,
  branch: EdgeBranch,
  assetSuffix = "",
): string {
  return isAmountCondition(cond)
    ? `the amount is ${branchAmountText(cond.config, branch, assetSuffix)}`
    : `the funds are released ${branchTimeText(cond.config, branch)}`;
}
