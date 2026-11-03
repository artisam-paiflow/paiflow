import {
  FEATURE_GATED_BLOCKS,
  disabledSurfaces,
  featureOffMessage,
  type FeatureFlags,
  type FeatureSurface,
} from "@/lib/feature-flags";
import type { FlowGraph, FlowNode } from "./schema";
import type { ValidationIssue } from "./issue";
import { MULTISIG_DISABLED_MESSAGE } from "./disabled-multisig";
function nodeSurfaces(n: FlowNode, off: readonly FeatureSurface[]): FeatureSurface[] {
  return off.filter((s) => {
    const gate = FEATURE_GATED_BLOCKS[s];
    if (gate.nodeTypes.includes(n.type)) return true;
    if (n.type === "condition" && gate.conditionKinds.includes(n.config.kind)) return true;
    return false;
  });
}
/**
 * One issue per node that uses a disabled surface or release exclusion (#722).
 * Kept apart from the structural rules in `validate.ts`: it only reads node
 * types and a few config values, so it never depends on the graph being
 * otherwise valid.
 */
export function hiddenSurfaceIssues(graph: FlowGraph, features: FeatureFlags): ValidationIssue[] {
  const off = disabledSurfaces(features);
  const issues: ValidationIssue[] = [];
  for (const n of graph.nodes) {
    // This release exclusion cannot be enabled by surface switches. Structural
    // validation without deployment features still reads historical definitions.
    if (n.type === "condition" && n.config.kind === "multisig") {
      issues.push({
        path: `nodes.${n.id}`,
        code: "FEATURE_DISABLED",
        nodeId: n.id,
        message: MULTISIG_DISABLED_MESSAGE,
        friendlyMessage: MULTISIG_DISABLED_MESSAGE,
      });
    }
    for (const s of nodeSurfaces(n, off)) {
      issues.push({
        path: `nodes.${n.id}`,
        code: "FEATURE_DISABLED",
        nodeId: n.id,
        message: `Node ${n.id} (${n.type}) uses the ${s} surface, which is disabled (${FEATURE_GATED_BLOCKS[s].envVar}=false)`,
        friendlyMessage: `${featureOffMessage(s)} ${FEATURE_GATED_BLOCKS[s].remedy}`.trim(),
      });
    }
  }
  return issues;
}
