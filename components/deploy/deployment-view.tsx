"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

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
}: {
  deploymentId: string;
  contractAddress: string | null;
  status: string;
  sep7Uri: string | null;
  initialEvents: Evt[];
}) {
  const [events, setEvents] = useState<Evt[]>(initialEvents);

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
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-lg font-semibold">Send funds</h2>
        {contractAddress ? (
          <>
            <p className="mt-1 text-xs text-zinc-400">
              Scan with any Stellar wallet (SEP-7).
            </p>
            <div className="mt-4 grid grid-cols-[160px_1fr] gap-4">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={sep7Uri ?? contractAddress} size={140} />
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-xs text-zinc-400">Contract address</div>
                  <button
                    onClick={() => copy(contractAddress)}
                    className="break-all text-left font-mono text-xs hover:text-brand-300"
                  >
                    {contractAddress}
                  </button>
                </div>
                {sep7Uri && (
                  <div>
                    <div className="text-xs text-zinc-400">SEP-7 URI</div>
                    <button
                      onClick={() => copy(sep7Uri)}
                      className="break-all text-left font-mono text-xs hover:text-brand-300"
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
            <li className="text-zinc-500">No events yet. Send funds to the contract to see them here.</li>
          )}
          {events.map((e) => (
            <li
              key={e.id}
              className="rounded border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-brand-300">{e.kind}</span>
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
  );
}
