import { bpsToPct, type FlowGraph } from "@/lib/flows/schema";
import type { ConfirmedNodeConfiguration } from "@/lib/flows/field-policies";
/** A display copy only. Never persist this over initial graph/pipeline evidence. */
export function projectConfirmedGraph(
  initial: FlowGraph,
  configurations: ConfirmedNodeConfiguration[],
): FlowGraph {
  const graph = structuredClone(initial);
  for (const snapshot of configurations) {
    const node = graph.nodes.find((n) => n.id === snapshot.nodeId),
      current = snapshot.configuration;
    if (node?.type === "pay" && current.kind === "pay") {
      if (current.recipient !== undefined) {
        if (node.config.recipient !== current.recipient) delete node.config.email;
        node.config.recipient = current.recipient;
      }
      if (current.payoutValue.kind === "fixed")
        node.config.amountStroops = current.payoutValue.amountStroops;
      if (current.payoutValue.kind === "percentage")
        node.config.percentage = bpsToPct(current.payoutValue.bps);
    } else if (node?.type === "split" && current.kind === "split") {
      current.configuredRows.forEach((stored, index) => {
        const row = node.config.recipients[index];
        if (!row) throw new Error("Confirmed row is missing from immutable graph");
        if (stored.recipient !== undefined) {
          if (row.address !== stored.recipient) delete row.email;
          row.address = stored.recipient;
        }
        if (stored.allocation?.kind === "fixed" && row.mode === "fixed")
          row.amountStroops = stored.allocation.amountStroops;
        if (stored.allocation?.kind === "percentage" && row.mode === "percentage")
          row.bps = stored.allocation.bps;
      });
      node.config.additionalRecipients = current.additionalRecipients;
    } else throw new Error("Confirmed node is missing from immutable graph");
  }
  return graph;
}
