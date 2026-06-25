"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import DeploymentCanvas from "./deployment-canvas";
import { LiveEvents, type Evt } from "./live-events";
import LiveBalances from "./live-balances";
import ContractCallButton from "./contract-call-button";
import SubscriptionRelayerPanel from "./subscription-relayer-panel";
import PayrollPanel from "./payroll-panel";
import OffRampSenderForm from "@/components/payroll/offramp-sender-form";
import type { FlowGraph } from "@/lib/flows/schema";
import { assetLabel, isTrigger } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";

export default function DeploymentView({
  deploymentId,
  contractAddress,
  network,
  status,
  qrUrl,
  initialEvents,
  graph,
  webhookSecret,
  pipeline,
  errorMessage,
}: {
  deploymentId: string;
  contractAddress: string | null;
  network: StellarNetwork | null;
  status: string;
  qrUrl: string | null;
  initialEvents: Evt[];
  graph: FlowGraph | null;
  webhookSecret: string | null;
  pipeline?: Array<{ nodeId: string; contractAddress: string; templateKind: string }> | null;
  errorMessage: string | null;
}) {
  const explorerUrl =
    contractAddress && network ? stellarExpertContractUrl(contractAddress, network) : null;
  const [pulse, setPulse] = useState(0);
  const [balanceTick, setBalanceTick] = useState(0);
  const [events, setEvents] = useState<Evt[]>(initialEvents);
  const [connectionStatus, setConnectionStatus] = useState<
    "live" | "reconnecting" | "disconnected"
  >("live");
  const esRef = useRef<EventSource | null>(null);

  const mergeEvents = (prev: Evt[], incoming: Evt[]) => {
    const merged = [...prev];
    let addedPulses = 0;
    let balanceChanges = 0;
    for (const data of incoming) {
      const isDuplicate = merged.some(
        (p) =>
          (p.eventId && data.eventId && p.eventId === data.eventId) ||
          (p.txHash === data.txHash && p.kind === data.kind),
      );
      if (!isDuplicate) {
        merged.push({ ...data, _isNew: true });
        if (data.kind === "RECEIVE" || data.kind === "PAYOUT") {
          addedPulses += 1;
        }
        if (
          data.kind === "RECEIVE" ||
          data.kind === "PAYOUT" ||
          data.kind === "CLAIM" ||
          data.kind === "CANCEL" ||
          data.kind === "SHORTFALL" ||
          data.kind === "FORWARD" ||
          data.kind === "ALLOWANCE"
        ) {
          balanceChanges += 1;
        }
      }
    }

    merged.sort((a, b) => {
      if (a.ledger !== b.ledger) return b.ledger - a.ledger;
      return (b.eventId ?? "").localeCompare(a.eventId ?? "");
    });

    if (addedPulses > 0) setPulse((p) => p + addedPulses);
    if (balanceChanges > 0) setBalanceTick((t) => t + balanceChanges);
    return merged.slice(0, 100);
  };

  const clearIsNew = (eventId: string | undefined, txHash: string, kind: string) => {
    setEvents((curr) =>
      curr.map((e) =>
        (e.eventId && eventId && e.eventId === eventId) || (e.txHash === txHash && e.kind === kind)
          ? { ...e, _isNew: false }
          : e,
      ),
    );
  };

  const scheduleClearIsNew = (eventId: string | undefined, txHash: string, kind: string) => {
    setTimeout(() => clearIsNew(eventId, txHash, kind), 250);
  };

  // Single source of live events for the deployment page. Uses SSE with a
  // one-time poll fallback when the connection drops.
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connectSSE = () => {
      if (cancelled) return;
      es = new EventSource(`/api/deployments/${deploymentId}/events`);
      esRef.current = es;

      es.addEventListener("connected", () => {
        if (!cancelled) setConnectionStatus("live");
      });

      es.addEventListener("message", (e) => {
        if (cancelled) return;
        try {
          const event = JSON.parse(e.data) as Evt | { type: string; status: string };
          if ("type" in event && event.type === "status" && event.status === "CONFIRMED") {
            window.location.reload();
            return;
          }
          const contractEvent = event as Evt;
          setEvents((prev) => mergeEvents(prev, [contractEvent]));
          scheduleClearIsNew(contractEvent.eventId, contractEvent.txHash, contractEvent.kind);
        } catch {
          /* ignore malformed SSE messages */
        }
      });

      es.onerror = () => {
        if (cancelled) return;
        setConnectionStatus("disconnected");
        if (es) {
          es.close();
          esRef.current = null;
          es = null;
        }

        // Fallback: poll once for any missed events, then reconnect.
        const fallbackUrl = `/api/deployments/${deploymentId}/poll-events`;
        fetch(fallbackUrl)
          .then((r) => r.json())
          .then(({ events: polledEvents }: { events: Evt[] }) => {
            if (cancelled) return;
            setEvents((prev) => mergeEvents(prev, polledEvents));
            polledEvents.forEach((ev) => scheduleClearIsNew(ev.eventId, ev.txHash, ev.kind));
          })
          .catch(() => null);

        reconnectTimer = setTimeout(() => {
          if (!cancelled) {
            setConnectionStatus("reconnecting");
            connectSSE();
          }
        }, 5000);
      };
    };

    connectSSE();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        es.close();
        esRef.current = null;
      }
      setConnectionStatus("disconnected");
    };
  }, [deploymentId]);

  // Poll status while waiting for the deployment to be confirmed.
  useEffect(() => {
    if (status === "CONFIRMED") return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/deployments/${deploymentId}/status`);
        if (!r.ok) return;
        const { status: newStatus } = (await r.json()) as { status: string };
        if (newStatus === "CONFIRMED") {
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(id);
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
  const streamerNode = pipeline?.find((n) => n.templateKind === "STREAMER");
  const isStreamer = !!streamerNode;
  const subscriptionNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION");
  const isSubscription = !!subscriptionNode;
  const payrollNode = pipeline?.find(
    (n) => n.templateKind === "PAYROLL" || n.templateKind === "SUBSCRIPTION_DEV",
  );
  const isPayroll = !!payrollNode;
  const cashOutNode = pipeline?.find(
    (n) => n.templateKind === "CASH_OUT" || n.templateKind === "CASH_OUT_DEV",
  );
  const isCashOut = !!cashOutNode;
  const triggerNode = graph?.nodes.find(isTrigger);
  const pauseAllowed =
    triggerNode?.type === "on_schedule" ? (triggerNode.config.pauseAllowed ?? true) : true;
  const retrieveAllowedFromConfig =
    triggerNode?.type === "on_schedule" ? (triggerNode.config.retrieveAllowed ?? false) : false;

  const [isPaused, setIsPaused] = useState(false);
  const [retrieveAllowed, setRetrieveAllowed] = useState(retrieveAllowedFromConfig);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [isCancelled, setIsCancelled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!subscriptionNode?.contractAddress || !network) return;
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/subscription-allowance`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: {
            allowance: string;
            subscriber: string;
            asset: { kind: string };
            isCancelled: boolean;
          };
        };
        if (!cancelled) {
          setAllowance(BigInt(json.data.allowance));
          setIsCancelled(json.data.isCancelled);
        }
      })
      .catch(() => {
        // Ignore read errors; the UI simply won't show the allowance.
      });
    return () => {
      cancelled = true;
    };
  }, [deploymentId, subscriptionNode?.contractAddress, network, balanceTick]);

  useEffect(() => {
    if (!streamerNode?.contractAddress || !network) return;
    let cancelled = false;
    fetch(`/api/deployments/${deploymentId}/streamer-state`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: { paused: boolean; retrieveAllowed: boolean };
        };
        if (!cancelled) {
          setIsPaused(json.data.paused);
          setRetrieveAllowed(json.data.retrieveAllowed);
        }
      })
      .catch(() => {
        // Ignore read errors; the local fallback is acceptable.
      });
    return () => {
      cancelled = true;
    };
  }, [deploymentId, streamerNode?.contractAddress, network]);

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
      <LiveBalances deploymentId={deploymentId} network={network} refreshTick={balanceTick} />
      <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
        <section className="glass-panel p-md rounded-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Trigger</h2>
            {isStreamer ? (
              <span className="border-primary/30 bg-primary/10 text-label-sm text-primary inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
                <span className="material-symbols-outlined text-[12px]">schedule</span>
                SCHEDULED
              </span>
            ) : isWeb2Webhook ? (
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
          {isSubscription && subscriptionNode?.contractAddress && network && (
            <div className="mt-md space-y-md">
              <p className="text-label-sm text-on-surface-variant font-mono">
                SCAN WITH FREIGHTER WALLET · APPROVE ALLOWANCE FOR RECURRING PAYMENTS.
              </p>
              <div className="gap-md grid grid-cols-[160px_1fr]">
                <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-white p-3">
                  {qrUrl ? (
                    <img src={qrUrl} width={140} height={140} alt="QR code" />
                  ) : (
                    <span className="font-mono text-xs text-zinc-400">NO QR YET</span>
                  )}
                </div>
                <div className="text-body-md space-y-3">
                  {allowance !== null && triggerNode?.type === "subscription" && (
                    <div>
                      <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                        Current allowance
                      </div>
                      <div className="text-on-surface mt-1 font-mono text-[12px]">
                        {formatStroops(allowance.toString())} {assetLabel(triggerNode.config.asset)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                      Subscriber
                    </div>
                    <div className="text-on-surface mt-1 font-mono text-[12px] break-all">
                      {triggerNode?.type === "subscription" ? triggerNode.config.subscriber : "—"}
                    </div>
                  </div>
                  <a
                    href={`/allowance/${deploymentId}`}
                    className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 inline-block rounded border px-3 py-1.5 font-mono text-xs transition-colors"
                  >
                    OPEN ALLOWANCE PAGE
                  </a>
                </div>
              </div>
              <SubscriptionRelayerPanel deploymentId={deploymentId} network={network} />
              <div className="flex flex-wrap items-center gap-3">
                <ContractCallButton
                  deploymentId={deploymentId}
                  network={network}
                  label="CHARGE NOW"
                  busyLabel="CHARGING…"
                  icon="bolt"
                  variant="secondary"
                  size="sm"
                  prepare={async (address) => {
                    const res = await fetch(
                      `/api/deployments/${deploymentId}/subscription-charge`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ userAddress: address }),
                      },
                    );
                    const json = (await res.json()) as {
                      data?: { xdr: string; networkPassphrase: string };
                      error?: { message?: string };
                    };
                    if (!res.ok) {
                      throw new Error(json.error?.message ?? "Unknown error");
                    }
                    const data = json.data;
                    if (!data) throw new Error("Prepare failed");
                    return { xdr: data.xdr, networkPassphrase: data.networkPassphrase };
                  }}
                  submit={async (signedXdr) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ signedXdr }),
                    });
                    const json = (await res.json()) as { data: { txHash: string } };
                    if (!res.ok) throw new Error("Submit failed");
                    return { txHash: json.data.txHash };
                  }}
                  onSuccess={() => {
                    setBalanceTick((t) => t + 1);
                  }}
                />
                {isCancelled === null ? (
                  <button
                    disabled
                    className="bg-surface-variant text-on-surface-variant inline-flex cursor-not-allowed items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">sync</span>
                    LOADING…
                  </button>
                ) : isCancelled ? (
                  <ContractCallButton
                    deploymentId={deploymentId}
                    network={network}
                    label="SUBSCRIBE"
                    busyLabel="SUBSCRIBING…"
                    icon="check_circle"
                    variant="secondary"
                    size="sm"
                    prepare={async (address) => {
                      const res = await fetch(
                        `/api/deployments/${deploymentId}/subscription-subscribe`,
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ userAddress: address }),
                        },
                      );
                      const json = (await res.json()) as {
                        data?: { xdr: string; networkPassphrase: string };
                        error?: { message?: string };
                      };
                      if (!res.ok) {
                        throw new Error(json.error?.message ?? "Unknown error");
                      }
                      const data = json.data;
                      if (!data) throw new Error("Prepare failed");
                      return { xdr: data.xdr, networkPassphrase: data.networkPassphrase };
                    }}
                    submit={async (signedXdr) => {
                      const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ signedXdr }),
                      });
                      const json = (await res.json()) as { data: { txHash: string } };
                      if (!res.ok) throw new Error("Submit failed");
                      return { txHash: json.data.txHash };
                    }}
                    onSuccess={() => {
                      setIsCancelled(false);
                      setBalanceTick((t) => t + 1);
                    }}
                  />
                ) : (
                  <ContractCallButton
                    deploymentId={deploymentId}
                    network={network}
                    label="UNSUBSCRIBE"
                    busyLabel="UNSUBSCRIBING…"
                    icon="cancel"
                    variant="danger"
                    size="sm"
                    prepare={async (address) => {
                      const res = await fetch(
                        `/api/deployments/${deploymentId}/subscription-unsubscribe`,
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ userAddress: address }),
                        },
                      );
                      const json = (await res.json()) as {
                        data?: { xdr: string; networkPassphrase: string };
                        error?: { message?: string };
                      };
                      if (!res.ok) {
                        throw new Error(json.error?.message ?? "Unknown error");
                      }
                      const data = json.data;
                      if (!data) throw new Error("Prepare failed");
                      return { xdr: data.xdr, networkPassphrase: data.networkPassphrase };
                    }}
                    submit={async (signedXdr) => {
                      const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ signedXdr }),
                      });
                      const json = (await res.json()) as { data: { txHash: string } };
                      if (!res.ok) throw new Error("Submit failed");
                      return { txHash: json.data.txHash };
                    }}
                    onSuccess={() => {
                      setIsCancelled(true);
                      setAllowance(0n);
                      setBalanceTick((t) => t + 1);
                    }}
                  />
                )}
              </div>
            </div>
          )}
          {isPayroll && payrollNode?.contractAddress && network && graph && (
            <PayrollPanel
              deploymentId={deploymentId}
              contractAddress={payrollNode.contractAddress}
              network={network}
              graph={graph}
            />
          )}
          {isCashOut && !isPayroll && (
            <div className="glass-panel mt-md p-md rounded-xl">
              <div className="mb-3">
                <p className="text-label-sm text-on-surface-variant font-mono uppercase">
                  / OFF-RAMP SENDER KYC
                </p>
                <p className="text-on-surface-variant mt-1 font-mono text-xs">
                  PDAX requires sender details for every fiat withdrawal, including cash-out.
                </p>
              </div>
              <OffRampSenderForm deploymentId={deploymentId} />
            </div>
          )}
          {isStreamer && streamerNode.contractAddress && network && pauseAllowed && (
            <div className="mt-md flex items-center gap-3">
              {isPaused ? (
                <ContractCallButton
                  deploymentId={deploymentId}
                  network={network}
                  label="RESUME"
                  busyLabel="RESUMING…"
                  icon="play_arrow"
                  variant="secondary"
                  size="sm"
                  prepare={async (address) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        method: "unpause",
                        contractAddress: streamerNode.contractAddress,
                        userAddress: address,
                      }),
                    });
                    const json = (await res.json()) as {
                      data?: { xdr: string; networkPassphrase: string };
                      error?: { message?: string };
                    };
                    if (!res.ok) {
                      throw new Error(json.error?.message ?? "Unknown error");
                    }
                    const data = json.data;
                    if (!data) throw new Error("Prepare failed");
                    return {
                      xdr: data.xdr,
                      networkPassphrase: data.networkPassphrase,
                    };
                  }}
                  submit={async (signedXdr) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ signedXdr }),
                    });
                    const json = (await res.json()) as { data: { txHash: string } };
                    if (!res.ok) throw new Error("Submit failed");
                    return { txHash: json.data.txHash };
                  }}
                  onSuccess={() => setIsPaused(false)}
                />
              ) : (
                <ContractCallButton
                  deploymentId={deploymentId}
                  network={network}
                  label="PAUSE"
                  busyLabel="PAUSING…"
                  icon="pause"
                  variant="danger"
                  size="sm"
                  prepare={async (address) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        method: "pause",
                        contractAddress: streamerNode.contractAddress,
                        userAddress: address,
                      }),
                    });
                    const json = (await res.json()) as {
                      data?: { xdr: string; networkPassphrase: string };
                      error?: { message?: string };
                    };
                    if (!res.ok) {
                      throw new Error(json.error?.message ?? "Unknown error");
                    }
                    const data = json.data;
                    if (!data) throw new Error("Prepare failed");
                    return {
                      xdr: data.xdr,
                      networkPassphrase: data.networkPassphrase,
                    };
                  }}
                  submit={async (signedXdr) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ signedXdr }),
                    });
                    const json = (await res.json()) as { data: { txHash: string } };
                    if (!res.ok) throw new Error("Submit failed");
                    return { txHash: json.data.txHash };
                  }}
                  onSuccess={() => setIsPaused(true)}
                />
              )}
              {retrieveAllowed && (
                <ContractCallButton
                  deploymentId={deploymentId}
                  network={network}
                  label="RETRIEVE UNVESTED"
                  busyLabel="RETRIEVING…"
                  icon="account_balance_wallet"
                  variant="danger"
                  size="sm"
                  disabled={!isPaused}
                  prepare={async (address) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        method: "retrieve_unvested",
                        contractAddress: streamerNode.contractAddress,
                        userAddress: address,
                      }),
                    });
                    const json = (await res.json()) as {
                      data?: { xdr: string; networkPassphrase: string };
                      error?: { message?: string };
                    };
                    if (!res.ok) {
                      throw new Error(json.error?.message ?? "Unknown error");
                    }
                    const data = json.data;
                    if (!data) throw new Error("Prepare failed");
                    return {
                      xdr: data.xdr,
                      networkPassphrase: data.networkPassphrase,
                    };
                  }}
                  submit={async (signedXdr) => {
                    const res = await fetch(`/api/deployments/${deploymentId}/submit-invoke`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ signedXdr }),
                    });
                    const json = (await res.json()) as { data: { txHash: string } };
                    if (!res.ok) throw new Error("Submit failed");
                    return { txHash: json.data.txHash };
                  }}
                  onSuccess={() => {
                    // Balance refresh is handled by the existing polling/tick.
                  }}
                />
              )}
            </div>
          )}
          {isStreamer && streamerNode.contractAddress && network && !pauseAllowed && (
            <div className="mt-md text-label-sm text-on-surface-variant font-mono">
              Pause is disabled for this stream.
            </div>
          )}
          {status === "FAILED" ? (
            <div className="mt-md border-error/30 bg-error-container/20 flex items-start gap-2 rounded-lg border p-3">
              <span className="material-symbols-outlined text-error mt-0.5 shrink-0 text-[16px]">
                error
              </span>
              <div>
                <p className="text-label-sm text-error font-mono">DEPLOYMENT FAILED</p>
                {errorMessage && (
                  <p className="text-body-sm text-on-surface-variant mt-1">{errorMessage}</p>
                )}
              </div>
            </div>
          ) : status !== "CONFIRMED" ? (
            <div className="mt-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
              <span className="status-dot-deploy h-1.5 w-1.5" />
              CONTRACT IS DEPLOYING… QR WILL APPEAR WHEN READY.
            </div>
          ) : contractAddress ? (
            isWeb2Webhook ? (
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
                          <span className="material-symbols-outlined text-[14px]">
                            content_copy
                          </span>
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
                    <a
                      href={`/trigger/${deploymentId}`}
                      className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 inline-block rounded border px-3 py-1.5 font-mono text-xs transition-colors"
                    >
                      OPEN TRIGGER PAGE
                    </a>
                  </div>
                </div>
              </>
            ) : isSubscription || payrollNode?.templateKind === "SUBSCRIPTION_DEV" ? null : (
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
          ) : null}
        </section>

        <LiveEvents
          events={events}
          network={network}
          connectionStatus={connectionStatus}
          graph={graph}
        />
      </div>
    </div>
  );
}
