import "server-only";
import type { EventKind } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { toCanvasGraph, type CanvasGraph } from "@/lib/flows/canvas-graph";
import { isStellarNetwork, type StellarNetwork } from "@/lib/stellar/explorer";

export type PublicEmbedEvent = {
  eventId: string;
  kind: EventKind;
  ledger: number;
  txHash: string;
  occurredAt: string;
  amountStroops?: string;
};

export type PublicEmbedData = {
  deploymentId: string;
  contractAddress: string;
  network: StellarNetwork | null;
  graph: CanvasGraph;
  initialEvents: PublicEmbedEvent[];
};

type EmbedSource = {
  id: string;
  status: string;
  contractAddress: string | null;
  network: string | null;
  graphSnapshot: unknown;
  events: Array<{
    eventId: string;
    kind: EventKind;
    ledger: number;
    txHash: string;
    occurredAt: Date;
    decodedData: unknown;
  }>;
};

/** Explicit allowlist shared by public initial history and future public reads (#577).
 * Never spread a deployment, graph config, pipeline node, or event payload here.
 */
export function projectPublicEmbed(source: EmbedSource): PublicEmbedData | null {
  if (source.status !== "CONFIRMED" || !source.contractAddress) return null;
  const graph = FlowGraphSchema.safeParse(source.graphSnapshot);
  if (!graph.success) return null;
  return {
    deploymentId: source.id,
    contractAddress: source.contractAddress,
    network: isStellarNetwork(source.network) ? source.network : null,
    graph: toCanvasGraph(graph.data),
    initialEvents: source.events.map((event) => {
      const data = event.decodedData;
      const amount = data && typeof data === "object" && "amount" in data ? data.amount : undefined;
      return {
        eventId: event.eventId,
        kind: event.kind,
        ledger: event.ledger,
        txHash: event.txHash,
        occurredAt: event.occurredAt.toISOString(),
        ...(typeof amount === "string" && /^\d{1,39}$/.test(amount)
          ? { amountStroops: amount }
          : {}),
      };
    }),
  };
}
