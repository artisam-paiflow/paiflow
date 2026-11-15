import { TemplateKind } from "@prisma/client";
import {
  OrdinaryFlowGraphSchema,
  isConditionalCanvas,
  type OrdinaryFlowGraph,
} from "./ordinary-schema";
import { conditionalCanvasIssues } from "./conditional-canvas";
import { sandboxNotifications } from "./schema";
import { validateFlow } from "./validate";
import { flowToPipeline } from "./to-params";
import type { FeatureFlags } from "@/lib/feature-flags";

/** Ordinary page/API reader. Template readers deliberately keep FlowGraphSchema. */
export const readOrdinaryFlowGraph = (raw: unknown): OrdinaryFlowGraph =>
  OrdinaryFlowGraphSchema.parse(raw);
export const conditionalDraftParameters = () => ({
  generation: "conditional-v2" as const,
  version: 2 as const,
  draft: true as const,
});
export function ordinarySandboxNotifications(graph: OrdinaryFlowGraph): OrdinaryFlowGraph {
  if (!isConditionalCanvas(graph)) return sandboxNotifications(graph);
  const sanitized = sandboxNotifications({ nodes: graph.nodes, edges: graph.edges });
  return { ...graph, nodes: sanitized.nodes, notify: { mode: "off", sendTo: "" } };
}
/** Draft metadata is never a constructor, deployment manifest or capability. */
export function ordinaryFlowParameters(graph: OrdinaryFlowGraph) {
  if (isConditionalCanvas(graph))
    return {
      templateKind: TemplateKind.ROUTER,
      parameters: conditionalDraftParameters() as object,
    };
  const validated = validateFlow(graph, { ignoreOwnerEmail: true });
  if (!validated.ok) return null;
  return {
    templateKind: validated.templateKind,
    parameters: flowToPipeline(validated.graph, undefined, { forValidation: true }) as object,
  };
}
export function validateOrdinaryFlow(
  graph: OrdinaryFlowGraph,
  options?: { features?: FeatureFlags; ignoreOwnerEmail?: boolean },
) {
  if (!isConditionalCanvas(graph)) return validateFlow(graph, options);
  const errors = conditionalCanvasIssues(graph).map((issue) => ({
    path: issue.nodeId ? `nodes.${issue.nodeId}` : "graph",
    nodeId: issue.nodeId,
    message: issue.message,
    friendlyMessage: issue.message,
  }));
  return { ok: errors.length === 0, errors, templateKind: TemplateKind.ROUTER };
}
