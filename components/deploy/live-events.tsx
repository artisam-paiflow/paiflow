"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn, formatAmount, shortAddr, shortAddrExtraShort } from "@/lib/utils";
import { stellarExpertTxUrl, type StellarNetwork } from "@/lib/stellar/explorer";

export type Evt = {
  id: string;
  kind: string;
  ledger: number;
  txHash: string;
  payload: unknown;
  decodedData: Record<string, unknown> | null;
  occurredAt: string;
  _isNew?: boolean;
};

type Recipient = {
  address: string;
  amount?: string;
  label?: string;
  bps?: number;
};

type LiveEventsProps = {
  events: Evt[];
  network: StellarNetwork | null;
  connectionStatus?: "live" | "reconnecting" | "disconnected";
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

const TOTAL_BPS = 10000n;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeRecipients(value: unknown): Recipient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): Recipient | null => {
      if (typeof item === "string") return { address: item };
      if (item && typeof item === "object") {
        const address = (item as Record<string, unknown>).address;
        if (typeof address === "string") {
          return {
            address,
            amount:
              typeof (item as Record<string, unknown>).amount === "string"
                ? ((item as Record<string, unknown>).amount as string)
                : undefined,
            label:
              typeof (item as Record<string, unknown>).label === "string"
                ? ((item as Record<string, unknown>).label as string)
                : undefined,
            bps:
              typeof (item as Record<string, unknown>).bps === "number"
                ? ((item as Record<string, unknown>).bps as number)
                : undefined,
          };
        }
      }
      return null;
    })
    .filter((r): r is Recipient => r !== null);
}

function computeRecipientShares(totalAmount: string, recipients: Recipient[]): Recipient[] {
  const total = BigInt(totalAmount);
  let distributed = 0n;
  return recipients.map((r, index) => {
    if (isNonEmptyString(r.amount)) return r;
    if (typeof r.bps !== "number") return r;
    const isLast = index === recipients.length - 1;
    const share = isLast ? total - distributed : (total * BigInt(r.bps)) / TOTAL_BPS;
    distributed += share;
    return { ...r, amount: share.toString() };
  });
}

function formatAsset(asset: unknown): string {
  if (!asset) return "XLM";
  const str = String(asset);
  if (str.length > 20) return shortAddrExtraShort(str);
  return str;
}

function formatAmountWithAsset(amount: unknown, asset?: unknown): string {
  if (amount === undefined || amount === null) return "—";
  return `${formatAmount(String(amount))} ${formatAsset(asset)}`;
}

function AddressValue({ addr }: { addr: unknown }) {
  const full = isNonEmptyString(addr) ? addr : "—";
  const short = full.length > 14 ? shortAddr(full, 6, 6) : full;
  return (
    <span className="font-mono text-[11px]" title={full}>
      {short}
    </span>
  );
}

function DetailField({
  label,
  children,
  fullWidth,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn("min-w-0", fullWidth && "col-span-full")}>
      <div className="text-label-xs text-on-surface-variant font-mono uppercase">{label}</div>
      <div className="text-body-sm text-on-surface mt-0.5">{children}</div>
    </div>
  );
}

function RecipientList({
  recipients,
  totalAmount,
  asset,
}: {
  recipients: Recipient[];
  totalAmount?: string;
  asset?: unknown;
}) {
  const shares = useMemo(() => {
    if (!totalAmount) return recipients;
    try {
      return computeRecipientShares(totalAmount, recipients);
    } catch {
      return recipients;
    }
  }, [recipients, totalAmount]);

  if (shares.length === 0) return null;

  return (
    <div className="space-y-1">
      {shares.slice(0, 4).map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <AddressValue addr={r.address} />
          {r.label && <span className="text-label-xs text-on-surface-variant">({r.label})</span>}
          {typeof r.bps === "number" && (
            <span className="text-label-xs text-on-surface-variant font-mono">{r.bps / 100}%</span>
          )}
          {isNonEmptyString(r.amount) && (
            <span className="text-body-sm text-on-surface ml-auto font-medium">
              {formatAmountWithAsset(r.amount, asset)}
            </span>
          )}
        </div>
      ))}
      {shares.length > 4 && (
        <div className="text-label-xs text-on-surface-variant font-mono">
          +{shares.length - 4} more
        </div>
      )}
    </div>
  );
}

function EventDetails({ evt }: { evt: Evt }) {
  const d = evt.decodedData as Record<string, unknown> | null;

  switch (evt.kind) {
    case "RECEIVE": {
      const from = d?.from ?? d?.subscriber;
      const amount = d?.amount;
      const asset = d?.asset;
      const vault = d?.vault;
      const price = d?.price;

      return (
        <div className="space-y-2">
          <div className="text-body-sm text-on-surface">
            {vault ? (
              <>
                Deposited{" "}
                <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span> to vault{" "}
                <AddressValue addr={vault} />
              </>
            ) : from ? (
              <>
                Received <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>{" "}
                from <AddressValue addr={from} />
              </>
            ) : (
              <>
                Received <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {isNonEmptyString(from) && (
              <DetailField label="From">
                <AddressValue addr={from} />
              </DetailField>
            )}
            {isNonEmptyString(d?.subscriber) && (
              <DetailField label="Subscriber">
                <AddressValue addr={d.subscriber} />
              </DetailField>
            )}
            {isNonEmptyString(vault) && (
              <DetailField label="Vault">
                <AddressValue addr={vault} />
              </DetailField>
            )}
            <DetailField label="Amount">{formatAmountWithAsset(amount, asset)}</DetailField>
            {asset !== undefined && asset !== null && (
              <DetailField label="Asset">{formatAsset(asset)}</DetailField>
            )}
            {price !== undefined && price !== null && (
              <DetailField label="Price">{String(price)}</DetailField>
            )}
          </div>
        </div>
      );
    }
    case "PAYOUT": {
      const from = d?.from;
      const admin = d?.admin;
      const contract = d?.contract;
      const asset = d?.asset;
      const amount = d?.amount ?? d?.amountOut ?? d?.balance ?? d?.payment;
      const assetIn = d?.assetIn;
      const assetOut = d?.assetOut;
      const amountIn = d?.amountIn;
      const amountOut = d?.amountOut;
      const recipient = d?.recipient;
      const recipients = normalizeRecipients(d?.recipients);
      const tookPathA = d?.tookPathA;

      if (assetIn && assetOut && amountIn !== undefined && amountOut !== undefined) {
        return (
          <div className="space-y-2">
            <div className="text-body-sm text-on-surface">
              Swapped{" "}
              <span className="font-medium">{formatAmountWithAsset(amountIn, assetIn)}</span> →{" "}
              <span className="font-medium">{formatAmountWithAsset(amountOut, assetOut)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <DetailField label="From">{formatAsset(assetIn)}</DetailField>
              <DetailField label="To">{formatAsset(assetOut)}</DetailField>
              <DetailField label="Amount in">
                {formatAmountWithAsset(amountIn, assetIn)}
              </DetailField>
              <DetailField label="Amount out">
                {formatAmountWithAsset(amountOut, assetOut)}
              </DetailField>
            </div>
          </div>
        );
      }

      if (tookPathA !== undefined && tookPathA !== null) {
        return (
          <div className="space-y-2">
            <div className="text-body-sm text-on-surface">
              Routed{" "}
              <span className="font-medium">{formatAmountWithAsset(amountOut, assetOut)}</span> via
              path{" "}
              <span className="font-medium">
                {tookPathA === true || tookPathA === "true" ? "A" : "B"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <DetailField label="Path">
                {tookPathA === true || tookPathA === "true" ? "A" : "B"}
              </DetailField>
              <DetailField label="Amount out">
                {formatAmountWithAsset(amountOut, assetOut)}
              </DetailField>
            </div>
          </div>
        );
      }

      if (isNonEmptyString(recipient)) {
        return (
          <div className="space-y-2">
            <div className="text-body-sm text-on-surface">
              Paid <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span> to{" "}
              <AddressValue addr={recipient} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <DetailField label="To">
                <AddressValue addr={recipient} />
              </DetailField>
              <DetailField label="Amount">{formatAmountWithAsset(amount, asset)}</DetailField>
              {asset !== undefined && asset !== null && (
                <DetailField label="Asset">{formatAsset(asset)}</DetailField>
              )}
            </div>
          </div>
        );
      }

      if (recipients.length > 0) {
        return (
          <div className="space-y-2">
            <div className="text-body-sm text-on-surface">
              Paid out <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>{" "}
              to <span className="font-medium">{recipients.length}</span> recipient
              {recipients.length === 1 ? "" : "s"}
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {isNonEmptyString(from) && (
                <DetailField label="From">
                  <AddressValue addr={from} />
                </DetailField>
              )}
              {isNonEmptyString(admin) && (
                <DetailField label="Admin">
                  <AddressValue addr={admin} />
                </DetailField>
              )}
              {amount !== undefined && amount !== null && (
                <DetailField label="Total amount">
                  {formatAmountWithAsset(amount, asset)}
                </DetailField>
              )}
              <DetailField label="Recipients" fullWidth>
                <RecipientList
                  recipients={recipients}
                  totalAmount={isNonEmptyString(amount) ? amount : undefined}
                  asset={asset}
                />
              </DetailField>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-2">
          <div className="text-body-sm text-on-surface">
            {admin ? (
              <>
                Released <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>{" "}
                to admin <AddressValue addr={admin} />
              </>
            ) : contract ? (
              <>
                Forwarded{" "}
                <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span> from
                contract <AddressValue addr={contract} />
              </>
            ) : from ? (
              <>
                Paid out <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>{" "}
                from <AddressValue addr={from} />
              </>
            ) : (
              <>
                Paid out <span className="font-medium">{formatAmountWithAsset(amount, asset)}</span>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {isNonEmptyString(from) && (
              <DetailField label="From">
                <AddressValue addr={from} />
              </DetailField>
            )}
            {isNonEmptyString(admin) && (
              <DetailField label="Admin">
                <AddressValue addr={admin} />
              </DetailField>
            )}
            {isNonEmptyString(contract) && (
              <DetailField label="Contract">
                <AddressValue addr={contract} />
              </DetailField>
            )}
            <DetailField label="Amount">{formatAmountWithAsset(amount, asset)}</DetailField>
            {asset !== undefined && asset !== null && (
              <DetailField label="Asset">{formatAsset(asset)}</DetailField>
            )}
          </div>
        </div>
      );
    }
    case "CLAIM": {
      const amount = d?.amount;
      const recipients = normalizeRecipients(d?.recipients);

      return (
        <div className="space-y-2">
          <div className="text-body-sm text-on-surface">
            Claimed <span className="font-medium">{formatAmountWithAsset(amount)}</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {amount !== undefined && amount !== null && (
              <DetailField label="Amount">{formatAmountWithAsset(amount)}</DetailField>
            )}
            {recipients.length > 0 && (
              <DetailField label="Recipients" fullWidth>
                <RecipientList
                  recipients={recipients}
                  totalAmount={isNonEmptyString(amount) ? amount : undefined}
                />
              </DetailField>
            )}
          </div>
        </div>
      );
    }
    case "CANCEL": {
      const balance = d?.balance;
      return (
        <div className="space-y-2">
          <div className="text-body-sm text-on-surface">
            Cancelled · remaining{" "}
            <span className="font-medium">{formatAmountWithAsset(balance)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <DetailField label="Remaining balance">{formatAmountWithAsset(balance)}</DetailField>
          </div>
        </div>
      );
    }
    case "STATUS_CHANGE": {
      const signer = d?.signer;
      return (
        <div className="space-y-2">
          <div className="text-body-sm text-on-surface">
            {isNonEmptyString(signer) ? "Multisig approved" : "Status changed"}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {isNonEmptyString(signer) && (
              <DetailField label="Signer">
                <AddressValue addr={signer} />
              </DetailField>
            )}
          </div>
        </div>
      );
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
    <li
      className={cn(
        "border-outline-variant/15 bg-surface-container-low/40 group hover:bg-surface-container-low/60 relative flex flex-col gap-2 rounded-lg border p-3 transition-colors",
        evt._isNew && "slide-event-in",
      )}
    >
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
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(evt.txHash);
                toast.success("Tx hash copied");
              } catch {
                const ta = document.createElement("textarea");
                ta.value = evt.txHash;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                toast.success("Tx hash copied");
              }
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

      <EventDetails evt={evt} />

      {expanded && (
        <div className="border-outline-variant/15 space-y-2 border-t pt-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="text-label-sm text-on-surface-variant font-mono">
              <span className="text-on-surface">Occurred:</span>{" "}
              {new Date(evt.occurredAt).toLocaleString()}
            </div>
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

export function LiveEvents({ events, network, connectionStatus = "live" }: LiveEventsProps) {
  const statusLabel =
    connectionStatus === "reconnecting"
      ? "RECONNECTING"
      : connectionStatus === "disconnected"
        ? "OFFLINE"
        : "LIVE";
  const dotClass =
    connectionStatus === "reconnecting"
      ? "status-dot-warn"
      : connectionStatus === "disconnected"
        ? "status-dot-error"
        : "status-dot-live";

  return (
    <section className="glass-panel p-md rounded-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Live events</h2>
        <span className="text-label-sm text-on-surface-variant inline-flex items-center gap-1.5 font-mono">
          <span className={`${dotClass} h-1.5 w-1.5`} />
          {statusLabel}
        </span>
      </div>
      <ul className="mt-md max-h-96 space-y-2 overflow-y-auto">
        {events.length === 0 && (
          <li className="border-outline-variant/30 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <span className="material-symbols-outlined text-on-surface-variant text-3xl">
              hourglass_empty
            </span>
            <span className="text-label-sm text-on-surface-variant font-mono">
              Waiting for on-chain activity…
            </span>
            <span className="text-label-xs text-on-surface-variant/60">
              Events will appear here once detected
            </span>
          </li>
        )}
        {events.map((e) => (
          <EventRow key={e.id} evt={e} network={network} />
        ))}
      </ul>
    </section>
  );
}
