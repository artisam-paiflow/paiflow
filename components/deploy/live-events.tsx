"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatStroops, shortAddrExtraShort } from "@/lib/utils";
import { stellarExpertTxUrl, type StellarNetwork } from "@/lib/stellar/explorer";
import type { FlowGraph } from "@/lib/flows/schema";

type Evt = {
  id: string;
  kind: string;
  ledger: number;
  txHash: string;
  payload: unknown;
  decodedData: Record<string, unknown> | null;
  occurredAt: string;
};

type DecodedData = Record<string, unknown>;

type Recipient = {
  address: string;
  amount?: string;
  label?: string;
  bps?: number;
};

type LiveEventsProps = {
  deploymentId: string;
  network: StellarNetwork | null;
  status: string;
  initialEvents: Evt[];
  graph: FlowGraph | null;
};

const KIND_META: Record<string, { label: string; color: string; icon: string }> = {
  RECEIVE: {
    label: "RECEIVE",
    color: "border-primary/30 bg-primary/10 text-primary",
    icon: "call_received",
  },
  PAYOUT: {
    label: "PAYOUT",
    color: "border-secondary/30 bg-secondary/10 text-secondary",
    icon: "call_made",
  },
  CLAIM: {
    label: "CLAIM",
    color: "border-tertiary/30 bg-tertiary/10 text-tertiary",
    icon: "withdraw",
  },
  CANCEL: { label: "CANCEL", color: "border-error/30 bg-error/10 text-error", icon: "cancel" },
  STATUS_CHANGE: {
    label: "STATUS",
    color: "border-outline-variant/30 bg-surface-container-low text-on-surface-variant",
    icon: "info",
  },
};

function formatAmount(raw: string | undefined, decimals = 7): string {
  if (!raw) return "—";
  return formatStroops(raw, decimals);
}

function EventSummary({ evt }: { evt: Evt }) {
  const d = evt.decodedData as Record<string, unknown> | null;

  switch (evt.kind) {
    case "RECEIVE": {
      const from = d?.from ? shortAddrExtraShort(String(d.from)) : "—";
      const amount = formatAmount(typeof d?.amount === "string" ? d.amount : undefined);
      return (
        <div className="text-body-sm text-on-surface">
          Received <span className="font-medium">{amount} XLM</span> from{" "}
          <span className="font-mono text-[11px]">{from}</span>
        </div>
      );
    }
    case "PAYOUT": {
      const from = d?.from ? shortAddrExtraShort(String(d.from)) : "—";
      const recipients = d?.recipients as Recipient[] | undefined;
      if (recipients && recipients.length > 0) {
        const parts = recipients.slice(0, 3).map((r) => {
          const addr = r.address ? shortAddrExtraShort(r.address) : "—";
          const amt = r.amount
            ? formatAmount(typeof r.amount === "string" ? r.amount : undefined)
            : "—";
          return `${amt} → ${addr}`;
        });
        const more = recipients.length > 3 ? ` +${recipients.length - 3} more` : "";
        return (
          <div className="text-body-sm text-on-surface">
            Paid out from <span className="font-mono text-[11px]">{from}</span>: {parts.join(", ")}
            {more}
          </div>
        );
      }
      return (
        <div className="text-body-sm text-on-surface">
          Payout from <span className="font-mono text-[11px]">{from}</span>
        </div>
      );
    }
    case "CLAIM": {
      const recipients = d?.recipients as Recipient[] | undefined;
      const amount = formatAmount(typeof d?.amount === "string" ? d.amount : undefined);
      if (recipients && recipients.length > 0) {
        const addrs = recipients
          .slice(0, 2)
          .map((r) => (r.address ? shortAddrExtraShort(r.address) : "—"))
          .join(", ");
        const more = recipients.length > 2 ? ` +${recipients.length - 2} more` : "";
        return (
          <div className="text-body-sm text-on-surface">
            Claimed <span className="font-medium">{amount} XLM</span> → {addrs}
            {more}
          </div>
        );
      }
      return (
        <div className="text-body-sm text-on-surface">
          Claimed <span className="font-medium">{amount} XLM</span>
        </div>
      );
    }
    case "CANCEL": {
      const balance = formatAmount(typeof d?.balance === "string" ? d.balance : undefined);
      return (
        <div className="text-body-sm text-on-surface">
          Stream cancelled · remaining <span className="font-medium">{balance} XLM</span>
        </div>
      );
    }
    case "STATUS_CHANGE": {
      return <div className="text-body-sm text-on-surface">Status changed</div>;
    }
    default: {
      if (d) {
        return (
          <pre className="text-on-surface-variant font-mono text-[10px] break-all whitespace-pre-wrap">
            {JSON.stringify(d, null, 2)}
          </pre>
        );
      }
      return <span className="text-body-sm text-on-surface-variant">No data</span>;
    }
  }
}

function EventIcon({ kind }: { kind: string }) {
  const meta = KIND_META[kind] ?? KIND_META["STATUS_CHANGE"]!;
  return (
    <span className={`material-symbols-outlined text-[14px] ${meta.color.split(" ")[2]}`}>
      {meta.icon}
    </span>
  );
}

function EventRow({ evt, network }: { evt: Evt; network: StellarNetwork | null }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[evt.kind] ?? KIND_META["STATUS_CHANGE"]!;
  const explorerBase = network ? stellarExpertTxUrl(evt.txHash, network) : null;

  return (
    <li className="border-outline-variant/15 bg-surface-container-low/40 space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <EventIcon kind={evt.kind} />
          <span
            className={`text-label-sm inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono ${meta.color}`}
          >
            {meta.label}
          </span>
          <span className="text-label-sm text-on-surface-variant font-mono">
            ledger #{evt.ledger.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-label-sm text-on-surface-variant font-mono">
            {new Date(evt.occurredAt).toLocaleTimeString()}
          </span>
          {explorerBase && (
            <a
              href={explorerBase}
              target="_blank"
              rel="noopener noreferrer"
              className="text-on-surface-variant hover:text-primary transition-colors"
              title="View on Stellar Expert"
            >
              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
            </a>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(evt.txHash);
              toast.success("Tx hash copied");
            }}
            className="text-on-surface-variant hover:text-primary transition-colors"
            title="Copy tx hash"
          >
            <span className="material-symbols-outlined text-[12px]">content_copy</span>
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-on-surface-variant hover:text-primary transition-colors"
            title={expanded ? "Collapse" : "Expand"}
          >
            <span className="material-symbols-outlined text-[12px]">
              {expanded ? "expand_less" : "expand_more"}
            </span>
          </button>
        </div>
      </div>

      <EventSummary evt={evt} />

      {expanded && (
        <div className="border-outline-variant/15 space-y-2 border-t pt-2">
          <div className="text-label-sm text-on-surface-variant font-mono">
            <span className="text-on-surface">Tx:</span>{" "}
            <a
              href={explorerBase ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary break-all"
            >
              {evt.txHash}
            </a>
          </div>
          {evt.decodedData && (
            <div>
              <div className="text-label-sm text-on-surface-variant mb-1 font-mono">
                Decoded data
              </div>
              <pre className="bg-surface-container-lowest border-outline-variant/15 text-on-surface overflow-x-auto rounded border p-2 font-mono text-[10px]">
                {JSON.stringify(evt.decodedData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function LiveEvents({
  deploymentId,
  network,
  status,
  initialEvents,
  graph,
}: LiveEventsProps) {
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

  return (
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
          <EventRow key={e.id} evt={e} network={network} />
        ))}
      </ul>
    </section>
  );
}
