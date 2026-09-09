import type { FlowGraph, FlowNode } from "./schema";
import { isTrigger } from "./schema";

/**
 * Node ids in the order value moves through them: a Kahn traversal seeded at
 * the trigger. A node is released only once every incoming edge has been
 * consumed, so a merge point appears after all of its sources.
 *
 * Edges touching an `email_notify` node are skipped, matching
 * `getPipelineChildren` in to-params.ts — those nodes are off-chain decorators
 * and are never wired as pipeline next steps, so they must not carry ordering
 * between the contracts that are.
 *
 * Nodes unreachable from the trigger, and nodes trapped behind a cycle, are
 * absent from the result rather than appended: only the caller knows whether
 * dropping them or keeping them in place is right.
 */
export function pipelineTopoOrder(graph: FlowGraph): string[] {
  const trigger = graph.nodes.find(isTrigger);
  if (!trigger) return [];

  const emailIds = new Set(graph.nodes.filter((n) => n.type === "email_notify").map((n) => n.id));
  const adj = new Map<string, string[]>();
  const remaining = new Map<string, number>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
    remaining.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (emailIds.has(e.source) || emailIds.has(e.target)) continue;
    adj.get(e.source)?.push(e.target);
    remaining.set(e.target, (remaining.get(e.target) ?? 0) + 1);
  }

  const order: string[] = [];
  const visited = new Set<string>([trigger.id]);
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nextId of adj.get(id) ?? []) {
      remaining.set(nextId, (remaining.get(nextId) ?? 0) - 1);
      if ((remaining.get(nextId) ?? 0) <= 0 && !visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return order;
}

/**
 * The given nodes sorted by `pipelineTopoOrder`, so `[0]` is the one closest to
 * the trigger rather than whichever block the user happened to drop on the
 * canvas first. Nodes the traversal never reached keep their original relative
 * order at the end, so the caller still sees every node it passed in — a
 * dropped node would silently change what validation counts.
 */
export function inFlowOrder<T extends FlowNode>(graph: FlowGraph, nodes: T[]): T[] {
  const position = new Map(pipelineTopoOrder(graph).map((id, i) => [id, i]));
  return [...nodes].sort((a, b) => {
    const ia = position.get(a.id);
    const ib = position.get(b.id);
    if (ia === undefined) return ib === undefined ? 0 : 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}
