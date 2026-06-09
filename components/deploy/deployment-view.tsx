"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import DeploymentCanvas from "./deployment-canvas";
import { LiveEvents, type Evt } from "./live-events";
import type { FlowGraph } from "@/lib/flows/schema";
import { isTrigger } from "@/lib/flows/schema";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";
import { POLL_EVENTS_INTERVAL_MS } from "@/lib/deployments/constants";

export default function DeploymentView({
  deploymentId,
  contractAddress,
  network,
  status,
  qrUrl,
  initialEvents,
  graph,
  webhookSecret,
}: {
  deploymentId: string;
  contractAddress: string | null;
  network: StellarNetwork | null;
  status: string;
  qrUrl: string | null;
  initialEvents: Evt[];
  graph: FlowGraph | null;
  webhookSecret: string | null;
}) {
  const explorerUrl =
    contractAddress && network ? stellarExpertContractUrl(contractAddress, network) : null;
  const [pulse, setPulse] = useState(0);
  const [events, setEvents] = useState<Evt[]>(initialEvents);
  const [connectionStatus, setConnectionStatus] = useState<
    "live" | "reconnecting" | "disconnected"
  >("live");

  // Single source of polling for the whole deployment page. Both the canvas
  // pulse animation and the LiveEvents feed derive from this one fetch.
  useEffect(() => {
    if (status !== "CONFIRMED") return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const updateStatus = () => {
      setConnectionStatus(
        failures === 0 ? "live" : failures >= 2 ? "disconnected" : "reconnecting",
      );
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/poll-events`);
        if (!res.ok) {
          failures += 1;
          updateStatus();
          return;
        }
        const { events: newEvents } = (await res.json()) as { events: Evt[] };
        if (failures > 0) {
          failures = 0;
          updateStatus();
        }

        setEvents((prev) => {
          const merged = [...prev];
          let addedPulses = 0;
          for (const data of newEvents) {
            const isDuplicate = merged.some(
              (p) => p.txHash === data.txHash && p.kind === data.kind,
            );
            if (!isDuplicate) {
              merged.unshift({ ...data, _isNew: true });
              setTimeout(() => {
                setEvents((curr) =>
                  curr.map((e) =>
                    e.txHash === data.txHash && e.kind === data.kind ? { ...e, _isNew: false } : e,
                  ),
                );
              }, 250);
              if (data.kind === "RECEIVE" || data.kind === "PAYOUT") {
                addedPulses += 1;
              }
            }
          }
          if (addedPulses > 0) setPulse((p) => p + addedPulses);
          return merged.slice(0, 100);
        });
      } catch {
        failures += 1;
        updateStatus();
      }
    };

    poll();
    intervalId = setInterval(poll, POLL_EVENTS_INTERVAL_MS);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [deploymentId, status]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Copied to clipboard.");
  }

  const isWeb2Webhook = graph?.nodes.find(isTrigger)?.type === "web2_webhook";
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="mt-md space-y-md">
      {graph && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Live flow</h2>
            <span className="text-label-sm text-on-surface-variant font-mono">
              EDGES PULSE ON-CHAIN EVENTS
            </span>
          </div>
          <DeploymentCanvas graph={graph} pulseTick={pulse} />
        </section>
      )}
      <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
        <section className="glass-panel p-md rounded-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Trigger</h2>
            {isWeb2Webhook ? (
              <span className="border-primary/30 bg-primary/10 text-label-sm text-primary inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
                <span className="material-symbols-outlined text-[12px]">http</span>
                HTTP WEBHOOK
              </span>
            ) : (
              <span className="border-secondary/30 bg-secondary/10 text-label-sm text-secondary inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
                <span className="material-symbols-outlined text-[12px]">qr_code_2</span>
                FREIGHTER
              </span>
            )}
          </div>
          {contractAddress ? (
            isWeb2Webhook ? (
              <>
                <p className="text-label-sm text-on-surface-variant mt-1 font-mono">
                  SEND AN HTTP POST WITH THE SECRET TO TRIGGER THIS FLOW.
                </p>
                <div className="mt-md space-y-3">
                  <div>
                    <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                      Webhook URL
                    </div>
                    <div className="mt-1 flex items-start gap-2">
                      <span className="text-on-surface font-mono text-[12px] break-all">
                        {appUrl}/api/webhooks/{deploymentId}
                      </span>
                      <button
                        onClick={() => copy(`${appUrl}/api/webhooks/${deploymentId}`)}
                        aria-label="Copy webhook URL"
                        title="Copy webhook URL"
                        className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                      </button>
                    </div>
                  </div>
                  {webhookSecret && (
                    <div>
                      <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                        Secret token
                      </div>
                      <div className="mt-1 flex items-start gap-2">
                        <span className="text-on-surface font-mono text-[12px] break-all">
                          {webhookSecret}
                        </span>
                        <button
                          onClick={() => copy(webhookSecret)}
                          aria-label="Copy webhook secret"
                          title="Copy webhook secret"
                          className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            content_copy
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
                    <strong>Payload:</strong>
                    <pre className="mt-1 overflow-x-auto font-mono text-[11px]">
                      {JSON.stringify({ from: "G...", amount: "10000000" }, null, 2)}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-label-sm text-on-surface-variant mt-1 font-mono">
                  SCAN WITH FREIGHTER WALLET · SET AMOUNT IN TRIGGER PAGE.
                </p>
                <div className="mt-md gap-md grid grid-cols-[160px_1fr]">
                  <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-white p-3">
                    {qrUrl ? (
                      <img src={qrUrl} width={140} height={140} alt="QR code" />
                    ) : (
                      <span className="font-mono text-xs text-zinc-400">NO QR YET</span>
                    )}
                  </div>
                  <div className="text-body-md space-y-3">
                    <div>
                      <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                        Contract address
                      </div>
                      <div className="mt-1 flex items-start gap-2">
                        {explorerUrl ? (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-on-surface hover:text-primary inline-flex items-center gap-1 text-left font-mono text-[12px] break-all transition-colors"
                          >
                            <span className="break-all">{contractAddress}</span>
                            <span className="material-symbols-outlined shrink-0 text-[12px]">
                              open_in_new
                            </span>
                          </a>
                        ) : (
                          <span className="text-on-surface font-mono text-[12px] break-all">
                            {contractAddress}
                          </span>
                        )}
                        <button
                          onClick={() => copy(contractAddress)}
                          aria-label="Copy contract address"
                          title="Copy contract address"
                          className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            content_copy
                          </span>
                        </button>
                      </div>
                    </div>
                    <a
                      href={`/trigger/${deploymentId}`}
                      className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 inline-block rounded border px-3 py-1.5 font-mono text-xs transition-colors"
                    >
                      OPEN TRIGGER PAGE
                    </a>
                  </div>
                </div>
              </>
            )
          ) : (
            <div className="mt-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
              <span className="status-dot-deploy h-1.5 w-1.5" />
              WAITING FOR CONFIRMATION…
            </div>
          )}
        </section>

        <LiveEvents events={events} network={network} connectionStatus={connectionStatus} />
      </div>
    </div>
  );
}
