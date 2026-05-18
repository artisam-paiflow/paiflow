import type { FlowGraph, FlowNode, FlowEdge } from "@/lib/flows/schema";
import { isAction, isLogic, isTrigger } from "@/lib/flows/schema";
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

function makeEdgeId() {
  return `auto-e-${Math.random().toString(36).slice(2, 8)}`;
}

export function autoConnectOrphans(graph: FlowGraph): FlowGraph {
  const trigger = graph.nodes.find(isTrigger);
  if (!trigger) return graph;

  // BFS from trigger to find all reachable nodes
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)?.push(e.target);

  const reachable = new Set<string>();
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) ?? []) queue.push(next);
  }

  // Collect orphan action/logic nodes
  const orphans = graph.nodes.filter((n) => !reachable.has(n.id) && (isAction(n) || isLogic(n)));
  if (!orphans.length) return graph;

  // Find the leaf of the reachable subgraph (a node with no outgoing edges inside reachable)
  let leaf = trigger.id;
  const seen = new Set<string>();
  const stack = [trigger.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const children = (adj.get(id) ?? []).filter((c) => reachable.has(c));
    if (!children.length) leaf = id;
    else for (const c of children) stack.push(c);
  }

  // Chain edges: leaf → orphan1 → orphan2 → ...
  const newEdges: FlowEdge[] = [];
  let prev = leaf;
  for (const orphan of orphans) {
    newEdges.push({ id: makeEdgeId(), source: prev, target: orphan.id });
    prev = orphan.id;
  }

  return { ...graph, edges: [...graph.edges, ...newEdges] };
}

export function stripZeroBpsRecipients(graph: FlowGraph): FlowGraph {
  const nodes = graph.nodes.map((n) => {
    if (n.type !== "split") return n;
    const filtered = n.config.recipients.filter((r) => r.bps > 0);
    if (filtered.length === n.config.recipients.length) return n;
    return { ...n, config: { ...n.config, recipients: filtered } } as FlowNode;
  });
  return { ...graph, nodes };
}
