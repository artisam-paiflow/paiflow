"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import DeploymentCanvas from "./deployment-canvas";
import type { FlowGraph } from "@/lib/flows/schema";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";

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
  network,
  status,
  qrUrl,
  distributeAmountStroops,
  initialEvents,
  graph,
}: {
  deploymentId: string;
  contractAddress: string | null;
  network: StellarNetwork | null;
  status: string;
  qrUrl: string | null;
  distributeAmountStroops: string | null;
  initialEvents: Evt[];
  graph: FlowGraph | null;
}) {
  const explorerUrl =
    contractAddress && network ? stellarExpertContractUrl(contractAddress, network) : null;
  const [events, setEvents] = useState<Evt[]>(initialEvents);
  const [pulse, setPulse] = useState(0);
  const [showAmountModal, setShowAmountModal] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [pendingAmount, setPendingAmount] = useState<string | null>(distributeAmountStroops);

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
    toast.success("Copied to clipboard.");
  }

  function openAmountModal() {
    setAmountInput(pendingAmount ?? "");
    setShowAmountModal(true);
  }

  function submitAmount() {
    if (!amountInput || !/^\d+$/.test(amountInput) || amountInput === "0") {
      toast.error("Enter a valid stroops amount (positive integer)");
      return;
    }
    setShowAmountModal(false);
    setPendingAmount(amountInput);
    fetch(`/api/deployments/${deploymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distributeAmountStroops: amountInput }),
    });
    toast.success("Amount saved.");
  }

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
            <h2 className="text-headline-sm text-on-surface">Trigger distribution</h2>
            <span className="border-secondary/30 bg-secondary/10 text-label-sm text-secondary inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
              <span className="material-symbols-outlined text-[12px]">qr_code_2</span>
              FREIGHTER
            </span>
          </div>
          {contractAddress ? (
            <>
              <p className="text-label-sm text-on-surface-variant mt-1 font-mono">
                SET AMOUNT · SCAN WITH FREIGHTER WALLET.
              </p>
              <div className="mt-md gap-md grid grid-cols-[160px_1fr]">
                <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-white p-3">
                  {qrUrl && pendingAmount ? (
                    <img
                      src={`${qrUrl}&amount=${encodeURIComponent(pendingAmount)}`}
                      width={140}
                      height={140}
                      alt="QR code"
                    />
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
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                      </button>
                    </div>
                  </div>
                  {pendingAmount && (
                    <div>
                      <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                        Amount (stroops)
                      </div>
                      <div className="text-on-surface font-mono text-[14px]">
                        {BigInt(pendingAmount).toLocaleString()}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={openAmountModal}
                    className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 rounded border px-3 py-1.5 font-mono text-xs transition-colors"
                  >
                    {pendingAmount ? "CHANGE AMOUNT" : "SET AMOUNT"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
              <span className="status-dot-deploy h-1.5 w-1.5" />
              WAITING FOR CONFIRMATION…
            </div>
          )}
        </section>

        <section className="glass-panel p-md rounded-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Live events</h2>
            <span className="text-label-sm text-on-surface-variant inline-flex items-center gap-1.5 font-mono">
              <span className="status-dot-live h-1.5 w-1.5" />
              SSE · ~15s
            </span>
          </div>
          <ul className="mt-md max-h-96 space-y-2 overflow-y-auto">
            {events.length === 0 && (
              <li className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded border border-dashed p-3 font-mono">
                NO EVENTS YET. TRIGGER DISTRIBUTE TO SEE THEM HERE.
              </li>
            )}
            {events.map((e) => (
              <li
                key={e.id}
                className="border-outline-variant/15 bg-surface-container-low/40 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="border-primary/30 bg-primary/10 text-label-sm text-primary inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono">
                    {e.kind}
                  </span>
                  <span className="text-label-sm text-on-surface-variant font-mono">
                    {new Date(e.occurredAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-on-surface-variant mt-2 font-mono text-[11px] break-all">
                  {e.txHash}
                </div>
                <pre className="border-outline-variant/15 bg-surface-container-lowest/60 text-on-surface mt-2 overflow-x-auto rounded border p-2 font-mono text-[11px]">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {showAmountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-panel w-full max-w-sm space-y-4 rounded-xl p-6">
            <h3 className="text-headline-sm text-on-surface font-semibold">
              Set Distribution Amount
            </h3>
            <p className="text-label-sm text-on-surface-variant font-mono">
              This amount will be locked into the transaction XDR. You cannot change it after
              scanning.
            </p>
            <label className="grid gap-1">
              <span className="text-xs text-zinc-400">Amount (stroops)</span>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 5000000"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && submitAmount()}
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAmountModal(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-400 hover:bg-zinc-900"
              >
                CANCEL
              </button>
              <button
                onClick={submitAmount}
                className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 rounded border px-3 py-1.5 font-mono text-xs"
              >
                GENERATE QR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
