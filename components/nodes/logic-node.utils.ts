import { BRANCH_LABEL, branchTestText, isBranchingCondition } from "@/lib/flows/branches";
import type { EdgeBranch, LogicNode } from "@/lib/flows/schema";

export type ConditionOutput = {
  /** React Flow source handle id, persisted as the edge's `sourceHandle`. */
  id: EdgeBranch;
  /** Visible text beside the handle; null for a condition's single output. */
  label: string | null;
  /** Horizontal position along the node's bottom edge, in percent. */
  leftPct: number;
};

/**
 * The source handles a condition node renders. Every condition has a "true"
 * output, so an edge saved with that handle keeps rendering if the kind
 * changes; a branching kind adds "false". A single-output kind still shows the
 * "false" handle while an edge hangs off it (from before a kind change), since
 * React Flow drops an edge whose handle is missing and the user could neither
 * see nor delete it; validateFlow reports it meanwhile.
 */
export function conditionOutputs(node: LogicNode, hasFalseEdge: boolean): ConditionOutput[] {
  if (!isBranchingCondition(node) && !hasFalseEdge) {
    return [{ id: "true", label: null, leftPct: 50 }];
  }
  return [
    { id: "true", label: BRANCH_LABEL.true, leftPct: 30 },
    { id: "false", label: BRANCH_LABEL.false, leftPct: 70 },
  ];
}

/**
 * What the outputs mean, for screen readers: React Flow's handles are not
 * focusable and carry no role, so the node's own text is where this has to be.
 */
export function conditionOutputsDescription(node: LogicNode): string | null {
  if (!isBranchingCondition(node)) return null;
  return `Two outputs. True: ${branchTestText(node, "true")}. False: ${branchTestText(node, "false")}.`;
}
