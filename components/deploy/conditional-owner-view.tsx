"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ConditionalDeploymentEnvelope } from "@/lib/flows/conditional-deployment";
import { conditionalDefinitionEnglish } from "@/lib/flows/conditional-canvas";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import { LiveEvents, type Evt } from "./live-events";
import LiveBalances from "./live-balances";
import { EditorConfigurationValues } from "./conditional-configuration-values";
const incomingEvent = z.object({
  id: z.string(),
  eventId: z.string().optional(),
  kind: z.string(),
  ledger: z.number().int().nonnegative(),
  txHash: z.string(),
  payload: z.unknown(),
  decodedData: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: z.string(),
});
/** Owner-only initial evidence and retained activity. Current configuration is
 * independently read by ConfigurationPanel; original terms never become current. */
export default function ConditionalOwnerView({
  deploymentId,
  original,
  network,
  status,
  errorMessage,
  initialEvents,
}: {
  deploymentId: string;
  original: ConditionalDeploymentEnvelope;
  network: StellarNetwork | null;
  status: string;
  errorMessage: string | null;
  initialEvents: Evt[];
}) {
  const [events, setEvents] = useState(initialEvents),
    [tick, setTick] = useState(0);
  const [connection, setConnection] = useState<"live" | "reconnecting" | "disconnected">(
    "reconnecting",
  );
  useEffect(() => {
    let disposed = false;
    const merge = (incoming: Evt[]) => {
      if (disposed) return;
      setEvents((prior) =>
        [
          ...new Map(
            [...incoming, ...prior].map((event) => [event.eventId ?? event.id, event]),
          ).values(),
        ]
          .sort((a, b) => b.ledger - a.ledger)
          .slice(0, 100),
      );
      setTick((value) => value + 1);
    };
    const source = new EventSource(`/api/deployments/${deploymentId}/events`);
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("reconnecting");
    source.onmessage = (message) => {
      try {
        const raw: unknown = JSON.parse(message.data);
        if (
          raw &&
          typeof raw === "object" &&
          "type" in raw &&
          raw.type === "status" &&
          "status" in raw &&
          raw.status === "CONFIRMED"
        ) {
          window.location.reload();
          return;
        }
        const event = incomingEvent.safeParse(raw);
        if (event.success) merge([event.data]);
      } catch {
        /* Reconnect/poll retains authoritative persisted evidence. */
      }
    };
    const poll = async () => {
      try {
        const response = await fetch(`/api/deployments/${deploymentId}/poll-events`);
        const body: unknown = await response.json();
        if (
          response.ok &&
          body &&
          typeof body === "object" &&
          "events" in body &&
          Array.isArray(body.events)
        )
          merge(z.array(incomingEvent).parse(body.events));
      } catch {
        if (!disposed) setConnection("disconnected");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 30000);
    return () => {
      disposed = true;
      source.close();
      clearInterval(timer);
    };
  }, [deploymentId]);
  return (
    <div className="mt-4 space-y-4">
      <p role="status">
        Deployment status: {status}
        {errorMessage ? ` · ${errorMessage}` : ""}
      </p>
      <details open className="glass-panel space-y-3 rounded-xl p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Initial conditional deployment evidence
        </summary>
        <p className="text-sm">{conditionalDefinitionEnglish(original.definition)}</p>
        <p className="break-all">Immutable deployment owner: {original.definition.owner}</p>
        <p className="font-mono text-xs break-all">Asset: {original.definition.assetContract}</p>
        <p className="text-sm">
          Original values and lifetime modes. These retained initial terms are separate from current
          stored configuration.
        </p>
        <EditorConfigurationValues values={original.manifest.nodes.map(({ state }) => state)} />
        {original.manifest.nodes.map((node) => (
          <p key={node.state.nodeId} className="font-mono text-xs break-all">
            {node.state.nodeId} · original artifact {node.wasmHash}
          </p>
        ))}
      </details>
      <LiveBalances deploymentId={deploymentId} network={network} refreshTick={tick} />
      <LiveEvents events={events} network={network} connectionStatus={connection} />
    </div>
  );
}
