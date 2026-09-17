import type { Asset, FlowGraph, FlowNode } from "./schema";
import { isContractAction, isTrigger } from "./schema";
import { inFlowOrder } from "./graph";

/**
 * A deployment's `pipelineSnapshot` entry: the durable map from a graph node to
 * the contract the factory deployed for it.
 */
export type PipelineNodeSnapshot = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
  salt?: unknown;
};

/**
 * The graph node whose contract emitted an event, resolved through the
 * deployment's pipeline snapshot rather than by re-deriving from the graph.
 */
export function resolveEmittingNode(params: {
  graph: FlowGraph | null;
  pipeline: PipelineNodeSnapshot[] | null;
  contractAddress: string;
}): FlowNode | undefined {
  const { graph, pipeline, contractAddress } = params;
  if (!graph) return undefined;

  const pipelineNode = pipeline?.find((n) => n?.contractAddress === contractAddress);
  if (!pipelineNode) return undefined;

  // Deployments written before the snapshot carried real node ids track the
  // primary contract with a synthetic nodeId of "trigger"; map it back to the
  // actual trigger node in the graph.
  if (pipelineNode.nodeId === "trigger") {
    return graph.nodes.find(isTrigger);
  }
  return graph.nodes.find((n) => n.id === pipelineNode.nodeId);
}

/**
 * The asset that flows *into* a node. `assetIn` comes first because a swap is
 * the one node whose `asset`-shaped config names its output: reading `asset`
 * first would label a swap's inbound leg with the asset it pays out.
 */
export function inboundAsset(node: FlowNode | undefined): Asset | undefined {
  if (!node || !("config" in node)) return undefined;
  const config = node.config as { asset?: Asset; assetIn?: Asset };
  return config.assetIn ?? config.asset;
}

/**
 * The asset that flows into the pipeline as a whole: the trigger's asset, else
 * the inbound asset of the earliest contract action. Ordering comes from
 * `inFlowOrder`, not `nodes` array order, so a graph that happens to list a
 * later action first still answers with the earlier one.
 */
export function flowInboundAsset(graph: FlowGraph | null | undefined): Asset | undefined {
  if (!graph) return undefined;

  const fromTrigger = inboundAsset(graph.nodes.find(isTrigger));
  if (fromTrigger) return fromTrigger;

  // `on_schedule` carries no asset, so fall through to the actions themselves.
  for (const action of inFlowOrder(graph, graph.nodes.filter(isContractAction))) {
    const asset = inboundAsset(action);
    if (asset) return asset;
  }
  return undefined;
}

/**
 * The inbound asset of the node that emitted an event, falling back to the
 * flow's own inbound asset when the emitter cannot be resolved (a deployment
 * with no pipeline snapshot). Server-side ingest and the client feed both
 * resolve through this, so a stamped row and an unstamped one agree.
 */
export function inboundAssetForContract(params: {
  graph: FlowGraph | null;
  pipeline: PipelineNodeSnapshot[] | null;
  contractAddress: string;
}): Asset | undefined {
  return inboundAsset(resolveEmittingNode(params)) ?? flowInboundAsset(params.graph);
}
