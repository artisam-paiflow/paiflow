import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { assetLabel, isAction, isLogic, isTrigger } from "@/lib/flows/schema";
import { BRANCH_LABEL, edgeBranch, isBranchingCondition } from "@/lib/flows/branches";
import { NODE_TYPE_LABELS } from "@/lib/flows/node-labels";

/** Display data only: never pass node configs to a public canvas. */
export type CanvasGraph = {
  nodes: Array<{ id: string; label: string; role: "trigger" | "action" | "logic" | "other" }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
};

function nodeLabel(n: FlowNode): string {
  switch (n.type) {
    case "on_receive":
      return `On Receive (${assetLabel(n.config.asset)})`;
    case "on_schedule":
      return `On Schedule (${(n.config as { intervalAmount?: number; intervalUnit?: string; interval?: string }).intervalAmount ?? 1} ${(n.config as { intervalAmount?: number; intervalUnit?: string; interval?: string }).intervalUnit ?? (n.config as { interval?: string }).interval ?? "hour"})`;
    case "webhook":
      return `Webhook (${assetLabel(n.config.asset)})`;
    case "web2_webhook":
      return `HTTP Webhook (${assetLabel(n.config.asset)})`;
    case "subscription":
      return `Subscription (${assetLabel(n.config.asset)})`;
    case "payroll":
      return `Payroll (${assetLabel(n.config.asset)})`;
    case "oracle":
      return `Oracle (${assetLabel(n.config.asset)})`;
    case "pay":
    case "hold":
    case "return_to_owner":
      return NODE_TYPE_LABELS[n.type];
    case "split":
      return n.config.recipients.length > 0 ? `Split (${n.config.recipients.length})` : "Split";
    case "swap":
      return `Swap (${assetLabel(n.config.assetIn)} → ${assetLabel(n.config.assetOut)})`;
    case "yield":
      return `Yield (${assetLabel(n.config.asset)})`;
    case "cash_out":
      return `Cash Out (${assetLabel(n.config.asset)})`;
    case "condition":
      return `Condition (${n.config.kind})`;
    default:
      return "Unknown";
  }
}

export function toCanvasGraph(graph: FlowGraph): CanvasGraph {
  const visible = graph.nodes.filter((n) => n.type !== "email_notify");
  const ids = new Set(visible.map((n) => n.id));
  return {
    nodes: visible.map((n) => ({
      id: n.id,
      label: nodeLabel(n),
      role: isTrigger(n) ? "trigger" : isAction(n) ? "action" : isLogic(n) ? "logic" : "other",
    })),
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        const src = visible.find((n) => n.id === e.source);
        const branch = isBranchingCondition(src) ? edgeBranch(e, src) : null;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(branch ? { label: BRANCH_LABEL[branch] } : {}),
        };
      }),
  };
}
