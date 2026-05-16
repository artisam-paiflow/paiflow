import type { FlowGraph, FlowNode, FlowEdge } from "@/lib/flows/schema";
import type { PatchOp } from "./prompts";

export function applyPatch(graph: FlowGraph, patch: PatchOp[]): FlowGraph {
  const nodes = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, structuredClone(n)]));
  const edges = new Map<string, FlowEdge>(graph.edges.map((e) => [e.id, structuredClone(e)]));

  for (const op of patch) {
    switch (op.op) {
      case "updateNode": {
        const existing = nodes.get(op.id);
        if (!existing) throw new Error(`updateNode: node ${op.id} not found`);
        nodes.set(op.id, { ...existing, config: { ...existing.config, ...op.config } } as FlowNode);
        break;
      }
      case "addNode": {
        const node = op.node as FlowNode;
        if (nodes.has(node.id)) throw new Error(`addNode: node ${node.id} already exists`);
        nodes.set(node.id, node);
        if (op.edge) {
          if (edges.has(op.edge.id)) throw new Error(`addNode: edge ${op.edge.id} already exists`);
          edges.set(op.edge.id, op.edge);
        }
        break;
      }
      case "removeNode": {
        if (!nodes.has(op.id)) throw new Error(`removeNode: node ${op.id} not found`);
        nodes.delete(op.id);
        for (const [eid, e] of edges) {
          if (e.source === op.id || e.target === op.id) {
            edges.delete(eid);
          }
        }
        break;
      }
      case "addEdge": {
        if (edges.has(op.edge.id)) throw new Error(`addEdge: edge ${op.edge.id} already exists`);
        edges.set(op.edge.id, op.edge);
        break;
      }
      case "removeEdge": {
        if (!edges.has(op.id)) throw new Error(`removeEdge: edge ${op.id} not found`);
        edges.delete(op.id);
        break;
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
