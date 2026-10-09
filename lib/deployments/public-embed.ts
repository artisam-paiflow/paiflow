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
  payment: { path: string; mode: "pay" | "fund" } | null;
};

type EmbedSource = {
  id: string;
  status: string;
  contractAddress: string | null;
  network: string | null;
  graphSnapshot: unknown;
  pipelineSnapshot?: unknown;
  flow?: { templateKind: string };
  events: Array<{
    eventId: string;
    kind: EventKind;
    ledger: number;
    txHash: string;
    occurredAt: Date;
    decodedData: unknown;
  }>;
};

export type PublicEventSource = EmbedSource["events"][number];

export const PUBLIC_EVENT_SELECT = {
  eventId: true,
  kind: true,
  ledger: true,
  txHash: true,
  occurredAt: true,
  decodedData: true,
} as const;

export function projectPublicEvent(event: PublicEventSource): PublicEmbedEvent {
  const data = event.decodedData;
  const amount = data && typeof data === "object" && "amount" in data ? data.amount : undefined;
  return {
    eventId: event.eventId,
    kind: event.kind,
    ledger: event.ledger,
    txHash: event.txHash,
    occurredAt: event.occurredAt.toISOString(),
    ...(typeof amount === "string" && /^\d{1,39}$/.test(amount) ? { amountStroops: amount } : {}),
  };
}

/** Match the existing public trigger page, without publishing its internal snapshot. */
export function publicPayment(
  source: Pick<EmbedSource, "id" | "pipelineSnapshot" | "flow" | "network">,
): PublicEmbedData["payment"] {
  if (!isStellarNetwork(source.network)) return null;
  const first: unknown = Array.isArray(source.pipelineSnapshot) ? source.pipelineSnapshot[0] : null;
  const kind =
    first && typeof first === "object" && "templateKind" in first ? first.templateKind : null;
  const legacy = source.flow?.templateKind;
  const noPipeline =
    !Array.isArray(source.pipelineSnapshot) || source.pipelineSnapshot.length === 0;
  if (
    kind !== "DEPOSIT_TRIGGER" &&
    kind !== "WEBHOOK" &&
    !(legacy === "STREAMER" && (noPipeline || kind === "STREAMER")) &&
    !(legacy === "SPLITTER" && noPipeline)
  )
    return null;
  return {
    path: `/trigger/${source.id}`,
    mode: kind === "WEBHOOK" || legacy === "STREAMER" ? "fund" : "pay",
  };
}

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
    initialEvents: source.events.map(projectPublicEvent),
    payment: publicPayment(source),
  };
}
