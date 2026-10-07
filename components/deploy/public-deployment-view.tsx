"use client";

import { useEffect, useReducer, useState } from "react";
import { ReadOnlyDeploymentCanvas } from "@/components/deploy/deployment-canvas";
import type { PublicEmbedData, PublicEmbedEvent } from "@/lib/deployments/public-embed";
import { mergePublicEvents, PublicSnapshotSchema } from "@/lib/deployments/public-embed-events";
import { stellarExpertContractUrl, stellarExpertTxUrl } from "@/lib/stellar/explorer";
import { formatStroops } from "@/lib/utils";

/** Public viewing has no owner controls, credential props, or private API reads. */
export default function PublicDeploymentView({ data }: { data: PublicEmbedData }) {
  const [activity, merge] = useReducer(
    (state: { events: PublicEmbedEvent[]; pulse: number }, incoming: PublicEmbedEvent[]) => {
      const seen = new Set(state.events.map((event) => event.eventId));
      const added = incoming.some((event) => !seen.has(event.eventId));
      return {
        events: mergePublicEvents(state.events, incoming),
        pulse: state.pulse + (added ? 1 : 0),
      };
    },
    { events: data.initialEvents, pulse: 0 },
  );
  const [status, setStatus] = useState<"connecting" | "live" | "updating" | "offline">(
    "connecting",
  );
  useEffect(() => {
    let stopped = false;
    let live = false;
    let source: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let polling: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let generation = 0;
    const base = `/api/deployments/${data.deploymentId}/embed`;
    const accept = (value: unknown) => {
      const snapshot = PublicSnapshotSchema.safeParse(value);
      if (!snapshot.success) return false;
      merge(snapshot.data.events);
      return true;
    };
    const poll = async () => {
      if (stopped || document.hidden) return;
      const current = generation;
      let delay = 15_000;
      if (!live) {
        request = new AbortController();
        try {
          const res = await fetch(`${base}/activity`, {
            signal: request.signal,
            cache: "no-store",
          });
          if (res.status === 429) {
            delay = Math.max(
              delay,
              Math.min(120_000, (Number(res.headers.get("Retry-After")) || 15) * 1000),
            );
          }
          const body: unknown = res.ok ? await res.json() : null;
          if (!stopped && current === generation && !live) {
            const payload = body && typeof body === "object" && "data" in body ? body.data : null;
            setStatus(res.ok && accept(payload) ? "updating" : "offline");
          }
        } catch {
          if (!stopped && current === generation && !live) setStatus("offline");
        }
      }
      if (!stopped && current === generation && !document.hidden)
        polling = setTimeout(() => void poll(), delay);
    };
    const connect = () => {
      if (stopped || document.hidden) return;
      const connection = new EventSource(`${base}/events`);
      source = connection;
      connection.addEventListener("connected", () => {
        if (stopped || source !== connection) return;
        live = true;
        setStatus("live");
      });
      connection.addEventListener("snapshot", (event) => {
        if (stopped || source !== connection) return;
        try {
          accept(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          /* Ignore malformed data. */
        }
      });
      connection.onerror = () => {
        if (stopped || source !== connection) return;
        live = false;
        connection.close();
        source = null;
        setStatus("updating");
        clearTimeout(reconnect);
        reconnect = setTimeout(connect, 30_000);
      };
    };
    const visibility = () => {
      generation += 1;
      clearTimeout(reconnect);
      clearTimeout(polling);
      request?.abort();
      source?.close();
      source = null;
      live = false;
      if (!document.hidden) {
        setStatus("connecting");
        connect();
        void poll();
      }
    };
    connect();
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      clearTimeout(polling);
      request?.abort();
      source?.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [data.deploymentId]);
  const explorerUrl = data.network
    ? stellarExpertContractUrl(data.contractAddress, data.network)
    : null;
  return (
    <div className="space-y-6">
      <section className="glass-panel p-md rounded-xl">
        <h1 className="text-headline-sm text-on-surface">Deployment</h1>
        <p className="text-label-sm text-on-surface-variant mt-2 font-mono">
          {data.network?.toUpperCase() ?? "NETWORK UNKNOWN"} · CONFIRMED
        </p>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary mt-2 block font-mono text-xs break-all"
          >
            {data.contractAddress}
          </a>
        ) : (
          <p className="mt-2 font-mono text-xs break-all">{data.contractAddress}</p>
        )}
      </section>
      {data.payment && (
        <section className="glass-panel p-md rounded-xl">
          <h2 className="text-headline-sm text-on-surface">
            {data.payment.mode === "fund" ? "Fund this flow" : "Make a payment"}
          </h2>
          <p className="text-label-sm text-on-surface-variant mt-2">
            Scan to open the wallet payment page. Review the network and amount before signing.
          </p>
          <a href={data.payment.path} className="text-primary mt-3 inline-block">
            {/* The public endpoint only encodes the customer page URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/deployments/${data.deploymentId}/embed/qr`}
              alt="Payment page QR code"
              width={256}
              height={256}
              className="rounded bg-white"
            />
            <span className="mt-2 block">Open payment page</span>
          </a>
          {data.payment.mode === "fund" && (
            <p className="text-label-sm text-on-surface-variant mt-2">
              This adds funds. It does not execute a webhook reward or release a stream.
            </p>
          )}
        </section>
      )}
      <ReadOnlyDeploymentCanvas graph={data.graph} pulseTick={activity.pulse} />
      <section className="glass-panel p-md rounded-xl">
        <h2 className="text-headline-sm text-on-surface">Recent activity</h2>
        <p className="text-label-sm text-on-surface-variant mt-2">
          <span role="status">
            {status === "live"
              ? "LIVE"
              : status === "connecting"
                ? "CONNECTING"
                : status === "updating"
                  ? "UPDATING"
                  : "OFFLINE"}
          </span>
          {status === "updating" && " · Checking for new activity periodically."}
        </p>
        <ul className="mt-md max-h-96 space-y-3 overflow-y-auto">
          {activity.events.length === 0 && <li>No recorded activity yet.</li>}
          {activity.events.map((event) => (
            <li
              key={event.eventId}
              className="border-outline-variant/30 rounded border p-3 font-mono text-xs"
            >
              <span>
                {event.kind} · ledger #{event.ledger}
              </span>
              {event.amountStroops !== undefined && (
                <span> · amount {formatStroops(event.amountStroops)}</span>
              )}
              <time dateTime={event.occurredAt} className="text-on-surface-variant mt-1 block">
                {event.occurredAt}
              </time>
              {data.network ? (
                <a
                  href={stellarExpertTxUrl(event.txHash, data.network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-1 block break-all"
                >
                  {event.txHash}
                </a>
              ) : (
                <span className="mt-1 block break-all">{event.txHash}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
