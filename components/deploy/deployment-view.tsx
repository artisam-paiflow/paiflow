"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import DeploymentCanvas from "./deployment-canvas";
import type { FlowGraph } from "@/lib/flows/schema";

type Evt = {
  id: string;
  kind: string;
  ledger: number;
  txHash: string;
  payload: unknown;
  occurredAt: string;
};

export default function DeploymentView({
  deploymentId,
  contractAddress,
  status,
  sep7Uri,
  initialEvents,
  graph,
}: {
  deploymentId: string;
  contractAddress: string | null;
  status: string;
  sep7Uri: string | null;
  initialEvents: Evt[];
  graph: FlowGraph | null;
}) {
  const [events, setEvents] = useState<Evt[]>(initialEvents);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (status !== "CONFIRMED") return;
    const es = new EventSource(`/api/deployments/${deploymentId}/events`);
    es.addEventListener("event", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as Evt;
        setEvents((prev) => {
          if (prev.some((p) => p.id === data.id || p.txHash === data.txHash)) return prev;
          return [data, ...prev].slice(0, 100);
        });
        if (data.kind === "RECEIVE" || data.kind === "PAYOUT") {
          setPulse((p) => p + 1);
        }
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [deploymentId, status]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  return (
    <div className="mt-8 space-y-6">
      {graph && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live flow</h2>
            <span className="text-xs text-zinc-500">
              Arrows animate when an on-chain event fires.
            </span>
          </div>
          <DeploymentCanvas graph={graph} pulseTick={pulse} />
        </section>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-lg font-semibold">Send funds</h2>
          {contractAddress ? (
            <>
              <p className="mt-1 text-xs text-zinc-400">Scan with any Stellar wallet (SEP-7).</p>
              <div className="mt-4 grid grid-cols-[160px_1fr] gap-4">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={sep7Uri ?? contractAddress} size={140} />
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-xs text-zinc-400">Contract address</div>
                    <button
                      onClick={() => copy(contractAddress)}
                      className="hover:text-brand-300 text-left font-mono text-xs break-all"
                    >
                      {contractAddress}
                    </button>
                  </div>
                  {sep7Uri && (
                    <div>
                      <div className="text-xs text-zinc-400">SEP-7 URI</div>
                      <button
                        onClick={() => copy(sep7Uri)}
                        className="hover:text-brand-300 text-left font-mono text-xs break-all"
                      >
                        {sep7Uri}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">
              Waiting for confirmation… the contract address will appear here.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-lg font-semibold">Live events</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Updates stream in via Server-Sent Events. Polling cadence ~15s.
          </p>
          <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-sm">
            {events.length === 0 && (
              <li className="text-zinc-500">
                No events yet. Send funds to the contract to see them here.
              </li>
            )}
            {events.map((e) => (
              <li key={e.id} className="rounded border border-zinc-800 bg-zinc-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-brand-300 font-medium">{e.kind}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(e.occurredAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-400">{e.txHash}</div>
                <pre className="mt-2 overflow-x-auto text-[11px] text-zinc-300">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
