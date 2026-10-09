import type { Asset, FlowGraph } from "./schema";
import { isTrigger } from "./schema";
import { edgeBranch, isTimeCondition, timelockSideBranch } from "./branches";
import type { ValidationIssue } from "./issue";

export const DEPLOYING_WALLET = "PENDING:deploying-wallet";

export function terminalOutcomeIssues(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "hold" && node.type !== "return_to_owner") continue;
    const incoming = graph.edges.filter((e) => e.target === node.id);
    const edge = incoming[0];
    const parent = graph.nodes.find((n) => n.id === edge?.source);
    let message: string | undefined;
    if (incoming.length !== 1 || parent?.type !== "condition") {
      message = "This outcome needs exactly one incoming edge, directly from a condition.";
    } else if (graph.edges.some((e) => e.source === node.id)) {
      message = "This outcome is terminal and cannot have outgoing edges.";
    } else if (node.type === "hold") {
      if (
        !isTimeCondition(parent) ||
        edgeBranch(edge!, parent) !== timelockSideBranch(parent.config.kind, "before")
      ) {
        message = "Hold is only allowed on the before side of a time condition.";
      }
    } else if (parent.config.kind === "oracle_gte") {
      message =
        "Return to owner cannot follow an oracle condition: it releases a fixed amount, not the full incoming balance.";
    }
    if (message)
      issues.push({
        path: `nodes.${node.id}`,
        nodeId: node.id,
        code: "TERMINAL_OUTCOME",
        message,
        friendlyMessage: message,
      });
  }
  return issues;
}

/** Internal lowering only; never save this graph or its symbolic owner address. */
export function resolveOwnerReturns(graph: FlowGraph, owner: string): FlowGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  function incomingAsset(id: string, seen = new Set<string>()): Asset {
    if (seen.has(id)) throw new Error("Cannot resolve return asset through a cycle");
    seen.add(id);
    const node = byId.get(id);
    if (node?.type === "swap") return node.config.assetOut;
    if (node && isTrigger(node) && "asset" in node.config) return node.config.asset;
    const edge = graph.edges.find((e) => e.target === id);
    if (!edge) throw new Error("Return to owner has no incoming asset");
    return incomingAsset(edge.source, seen);
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.type === "return_to_owner"
        ? {
            id: node.id,
            type: "pay" as const,
            config: {
              asset: incomingAsset(node.id),
              recipient: owner,
              mode: "percentage" as const,
              percentage: 100,
              fullAmount: true,
              fillValueViaApi: false,
              payoutMode: "crypto" as const,
            },
          }
        : node,
    ),
  };
}
