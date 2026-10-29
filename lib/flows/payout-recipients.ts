import type { Asset, FlowGraph } from "./schema";

export type PayoutRecipient = {
  nodeId: string;
  /** A `G…` account, or a `PENDING:` placeholder that is not an address yet. */
  address: string;
  label?: string;
  asset: Asset;
};

/**
 * Every wallet a flow pays out to on-chain: Pay recipients and Split
 * recipients. Only supported wallet recipients are returned.
 *
 * The asset is the node's own: validateFlow refuses a Pay or Split whose asset
 * differs from what flows into it, so on a valid graph this is also the asset
 * a swap upstream of it produces.
 */
export function payoutRecipients(graph: FlowGraph): PayoutRecipient[] {
  const out: PayoutRecipient[] = [];
  for (const n of graph.nodes) {
    if (n.type === "pay") {
      out.push({ nodeId: n.id, address: n.config.recipient, asset: n.config.asset });
    } else if (n.type === "split") {
      for (const r of n.config.recipients) {
        out.push({
          nodeId: n.id,
          address: r.address,
          ...(r.label ? { label: r.label } : {}),
          asset: n.config.asset,
        });
      }
    }
  }
  return out;
}
