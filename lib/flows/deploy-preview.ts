import type { FlowGraph } from "@/lib/flows/schema";
import {
  flowToPipeline,
  getStreamerPreviewFromPipeline,
  getSubscriptionPreviewFromPipeline,
} from "@/lib/flows/to-params";

export function deployPreviewFromGraph(graph: FlowGraph) {
  // The deploying wallet is not known until preparation; previews only read
  // schedule and amount parameters, so use the same mode as flow validation.
  const pipeline = flowToPipeline(graph, undefined, { forValidation: true });
  return getStreamerPreviewFromPipeline(pipeline) ?? getSubscriptionPreviewFromPipeline(pipeline);
}
