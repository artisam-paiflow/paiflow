"use client";

import type { FlowNode } from "@/lib/flows/schema";
import { isPendingAddress } from "@/lib/flows/schema";

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
        <div className="text-brand-400 text-xs tracking-wider uppercase">
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
            <div className="relative">
              <input
                className={`input font-mono ${isPendingAddress(node.config.recipient) ? "ring-1 ring-amber-700" : ""}`}
                value={node.config.recipient}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: { ...node.config, recipient: e.target.value.trim() },
                  })
                }
              />
              {isPendingAddress(node.config.recipient) && (
                <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
                  needs address
                </span>
              )}
            </div>
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
          <div className="text-xs text-zinc-400">Recipients (basis points must sum to 10000)</div>
          {node.config.recipients.map((r, i) => {
            const isPending = isPendingAddress(r.address);
            return (
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-[1fr_72px_28px] gap-1">
                  <div className="grid gap-0.5">
                    <input
                      className="input font-mono text-xs"
                      value={r.address}
                      placeholder="G... or PENDING:label"
                      onChange={(e) => {
                        const next = [...node.config.recipients];
                        next[i] = { ...r, address: e.target.value.trim() };
                        onChange({ ...node, config: { ...node.config, recipients: next } });
                      }}
                    />
                  </div>
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
                <div className="grid grid-cols-[1fr_72px] gap-1">
                  <input
                    className="input text-xs"
                    value={r.label ?? ""}
                    placeholder="Label (e.g. Mom)"
                    onChange={(e) => {
                      const next = [...node.config.recipients];
                      next[i] = { ...r, label: e.target.value || undefined };
                      onChange({ ...node, config: { ...node.config, recipients: next } });
                    }}
                  />
                  {isPending && (
                    <span className="flex items-center text-[10px] text-amber-400">
                      needs address
                    </span>
                  )}
                </div>
              </div>
            );
          })}
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
                      address: "PENDING:unnamed",
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
        <>
          <Field label="Condition kind">
            <select
              className="input"
              value={node.config.kind}
              onChange={(e) => {
                const k = e.target.value;
                if (k === "amount_gt" || k === "amount_lt") {
                  onChange({ ...node, config: { kind: k, amountStroops: "10000000" } });
                } else if (k === "oracle_gte") {
                  onChange({
                    ...node,
                    config: {
                      kind: "oracle_gte",
                      oracle: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                      key: "price",
                      threshold: "100",
                    },
                  });
                } else if (k === "time_after" || k === "time_before") {
                  onChange({ ...node, config: { kind: k, at: new Date().toISOString() } });
                }
              }}
            >
              <option value="amount_gt">amount &gt;</option>
              <option value="amount_lt">amount &lt;</option>
              <option value="oracle_gte">oracle ≥ threshold</option>
              <option value="time_after">time after</option>
              <option value="time_before">time before</option>
            </select>
          </Field>
          {(node.config.kind === "amount_gt" || node.config.kind === "amount_lt") && (
            <Field label="Amount (stroops)">
              <input
                className="input"
                value={node.config.amountStroops}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  const next =
                    node.config.kind === "amount_gt"
                      ? { kind: "amount_gt" as const, amountStroops: v }
                      : { kind: "amount_lt" as const, amountStroops: v };
                  onChange({ ...node, config: next });
                }}
              />
            </Field>
          )}
          {node.config.kind === "oracle_gte" && (
            <>
              <Field label="Oracle contract / account">
                <input
                  className="input font-mono"
                  value={node.config.oracle}
                  onChange={(e) => {
                    const cfg = { ...node.config, oracle: e.target.value.trim() };
                    onChange({ ...node, config: cfg });
                  }}
                />
              </Field>
              <Field label="Storage key">
                <input
                  className="input"
                  value={node.config.key}
                  onChange={(e) => {
                    const cfg = { ...node.config, key: e.target.value };
                    onChange({ ...node, config: cfg });
                  }}
                />
              </Field>
              <Field label="Threshold">
                <input
                  className="input"
                  value={node.config.threshold}
                  onChange={(e) => {
                    const cfg = {
                      ...node.config,
                      threshold: e.target.value.replace(/\D/g, ""),
                    };
                    onChange({ ...node, config: cfg });
                  }}
                />
              </Field>
            </>
          )}
          {(node.config.kind === "time_after" || node.config.kind === "time_before") && (
            <Field label="At (ISO)">
              <input
                className="input"
                value={node.config.at}
                onChange={(e) => {
                  const at = e.target.value;
                  const next =
                    node.config.kind === "time_after"
                      ? { kind: "time_after" as const, at }
                      : { kind: "time_before" as const, at };
                  onChange({ ...node, config: next });
                }}
              />
            </Field>
          )}
        </>
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
  asset:
    | { kind: "native" }
    | { kind: "known"; symbol: "USDC" }
    | { kind: "custom"; code: string; issuer: string };
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
