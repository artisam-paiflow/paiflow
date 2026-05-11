"use client";

import type { FlowNode } from "@/lib/flows/schema";

type Props = {
  node: FlowNode | null;
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
};

export default function ConfigPanel({ node, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <aside className="border-l border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
        Select a block on the canvas to edit it.
      </aside>
    );
  }

  return (
    <aside className="space-y-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-brand-400">
          {node.type.replace("_", " ")}
        </div>
        <button
          onClick={() => onDelete(node.id)}
          className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
        >
          Delete
        </button>
      </div>

      {node.type === "on_receive" && (
        <AssetField
          asset={node.config.asset}
          onChange={(asset) => onChange({ ...node, config: { asset } })}
        />
      )}

      {node.type === "on_schedule" && (
        <>
          <Field label="Interval">
            <select
              value={node.config.interval}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    interval: e.target.value as "minute" | "hour" | "day",
                  },
                })
              }
              className="input"
            >
              <option value="minute">Every minute</option>
              <option value="hour">Every hour</option>
              <option value="day">Every day</option>
            </select>
          </Field>
          <Field label="Starts at (ISO)">
            <input
              className="input"
              value={node.config.startsAt}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, startsAt: e.target.value },
                })
              }
            />
          </Field>
        </>
      )}

      {node.type === "pay" && (
        <>
          <Field label="Recipient (G…)">
            <input
              className="input font-mono"
              value={node.config.recipient}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, recipient: e.target.value.trim() },
                })
              }
            />
          </Field>
          <Field label="Amount (stroops)">
            <input
              className="input"
              value={node.config.amountStroops}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    amountStroops: e.target.value.replace(/\D/g, ""),
                  },
                })
              }
            />
          </Field>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) => onChange({ ...node, config: { ...node.config, asset } })}
          />
        </>
      )}

      {node.type === "split" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) => onChange({ ...node, config: { ...node.config, asset } })}
          />
          <div className="text-xs text-zinc-400">
            Recipients (basis points must sum to 10000)
          </div>
          {node.config.recipients.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px_28px] gap-1">
              <input
                className="input font-mono text-xs"
                value={r.address}
                onChange={(e) => {
                  const next = [...node.config.recipients];
                  next[i] = { ...r, address: e.target.value.trim() };
                  onChange({ ...node, config: { ...node.config, recipients: next } });
                }}
              />
              <input
                className="input text-right"
                value={r.bps}
                onChange={(e) => {
                  const next = [...node.config.recipients];
                  next[i] = { ...r, bps: Number(e.target.value) || 0 };
                  onChange({ ...node, config: { ...node.config, recipients: next } });
                }}
              />
              <button
                onClick={() => {
                  const next = node.config.recipients.filter((_, j) => j !== i);
                  onChange({ ...node, config: { ...node.config, recipients: next } });
                }}
                className="rounded border border-zinc-800 text-zinc-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
            onClick={() =>
              onChange({
                ...node,
                config: {
                  ...node.config,
                  recipients: [
                    ...node.config.recipients,
                    {
                      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                      bps: 0,
                    },
                  ],
                },
              })
            }
          >
            + Add recipient
          </button>
        </>
      )}

      {node.type === "condition" && (
        <Field label="Condition kind">
          <select
            className="input"
            value={node.config.kind}
            onChange={(e) => {
              const kind = e.target.value as "amount_gt" | "amount_lt";
              onChange({
                ...node,
                config: { kind, amountStroops: "10000000" },
              });
            }}
          >
            <option value="amount_gt">amount &gt;</option>
            <option value="amount_lt">amount &lt;</option>
          </select>
        </Field>
      )}

      <style jsx>{`
        :global(.input) {
          background-color: #0a0a0f;
          border: 1px solid #27272a;
          padding: 0.4rem 0.6rem;
          border-radius: 0.375rem;
          font-size: 0.85rem;
          width: 100%;
        }
      `}</style>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function AssetField({
  asset,
  onChange,
}: {
  asset: { kind: "native" } | { kind: "known"; symbol: "USDC" } | { kind: "custom"; code: string; issuer: string };
  onChange: (a: typeof asset) => void;
}) {
  return (
    <Field label="Asset">
      <select
        className="input"
        value={asset.kind === "known" ? `known:${asset.symbol}` : asset.kind}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "native") onChange({ kind: "native" });
          else if (v === "known:USDC") onChange({ kind: "known", symbol: "USDC" });
        }}
      >
        <option value="known:USDC">USDC</option>
        <option value="native">XLM (native)</option>
      </select>
    </Field>
  );
}
