"use client";

import type { FlowNode } from "@/lib/flows/schema";

type Props = {
  node: FlowNode | null;
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
};

const NODE_META: Record<string, { eyebrow: string; icon: string; tone: string }> = {
  on_receive: { eyebrow: "TRIGGER · ON RECEIVE", icon: "toll", tone: "text-secondary" },
  on_schedule: { eyebrow: "TRIGGER · ON SCHEDULE", icon: "schedule", tone: "text-secondary" },
  pay: { eyebrow: "ACTION · PAY", icon: "payments", tone: "text-primary" },
  split: { eyebrow: "ACTION · SPLIT", icon: "call_split", tone: "text-primary" },
  condition: { eyebrow: "LOGIC · CONDITION", icon: "rule", tone: "text-tertiary" },
};

export default function ConfigPanel({ node, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <aside className="glass-panel-sidebar p-md h-full">
        <p className="text-label-sm text-on-surface-variant font-mono">/ INSPECTOR</p>
        <div className="mt-md border-outline-variant/30 bg-surface-container-lowest/40 p-md rounded-xl border border-dashed text-center">
          <span className="material-symbols-outlined text-on-surface-variant/40 text-[32px]">
            ads_click
          </span>
          <p className="text-body-md text-on-surface-variant mt-2">
            Select a block on the canvas to edit it.
          </p>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[node.type] ?? {
    eyebrow: node.type.toUpperCase(),
    icon: "settings",
    tone: "text-on-surface",
  };

  return (
    <aside className="glass-panel-sidebar flex h-full flex-col overflow-hidden">
      <div className="border-outline-variant/15 px-md flex items-center justify-between border-b py-3">
        <span className={`text-label-sm inline-flex items-center gap-2 font-mono ${meta.tone}`}>
          <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
          {meta.eyebrow}
        </span>
        <button
          onClick={() => onDelete(node.id)}
          className="border-error/40 text-label-sm text-error hover:bg-error-container/30 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
          DELETE
        </button>
      </div>

      <div className="space-y-md p-md overflow-y-auto">
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
                className="raft-input"
              >
                <option value="minute">Every minute</option>
                <option value="hour">Every hour</option>
                <option value="day">Every day</option>
              </select>
            </Field>
            <Field label="Starts at (ISO)">
              <input
                className="raft-input"
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
                className="raft-input"
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
                className="raft-input"
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
            <p className="text-label-sm text-on-surface-variant font-mono">
              RECIPIENTS · BPS MUST SUM TO 10000
            </p>
            <div className="space-y-2">
              {node.config.recipients.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px_28px] gap-1">
                  <input
                    className="raft-input"
                    value={r.address}
                    onChange={(e) => {
                      const next = [...node.config.recipients];
                      next[i] = { ...r, address: e.target.value.trim() };
                      onChange({ ...node, config: { ...node.config, recipients: next } });
                    }}
                  />
                  <input
                    className="raft-input text-right"
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
                    className="border-outline-variant/30 text-on-surface-variant hover:border-error/40 hover:text-error inline-flex items-center justify-center rounded border transition-colors"
                    aria-label="Remove recipient"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
              ))}
            </div>
            <button
              className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
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
              <span className="material-symbols-outlined text-[14px]">add</span>
              ADD RECIPIENT
            </button>
          </>
        )}

        {node.type === "condition" && (
          <>
            <Field label="Condition kind">
              <select
                className="raft-input"
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
                  className="raft-input"
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
                    className="raft-input"
                    value={node.config.oracle}
                    onChange={(e) => {
                      const cfg = { ...node.config, oracle: e.target.value.trim() };
                      onChange({ ...node, config: cfg });
                    }}
                  />
                </Field>
                <Field label="Storage key">
                  <input
                    className="raft-input"
                    value={node.config.key}
                    onChange={(e) => {
                      const cfg = { ...node.config, key: e.target.value };
                      onChange({ ...node, config: cfg });
                    }}
                  />
                </Field>
                <Field label="Threshold">
                  <input
                    className="raft-input"
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
                  className="raft-input"
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
      </div>

      <style jsx>{`
        :global(.raft-input) {
          background-color: #0e0e0e;
          border: 1px solid rgba(92, 63, 70, 0.4);
          padding: 0.45rem 0.65rem;
          border-radius: 0.125rem;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 13px;
          width: 100%;
          color: #e5e2e1;
          transition:
            border-color 150ms ease,
            box-shadow 150ms ease;
        }
        :global(.raft-input:focus) {
          outline: none;
          border-color: #ffb1c4;
          box-shadow: 0 0 0 1px #ffb1c4;
        }
      `}</style>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="group grid gap-1.5">
      <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
        {label}
      </span>
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
  const selectValue = asset.kind === "known" ? `known:${asset.symbol}` : asset.kind;

  return (
    <Field label="Asset">
      <select
        className="raft-input"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "native") onChange({ kind: "native" });
          else if (v === "known:USDC") onChange({ kind: "known", symbol: "USDC" });
        }}
      >
        <option value="known:USDC">USDC</option>
        <option value="native">XLM (native)</option>
        {asset.kind === "custom" && <option value="custom">{asset.code} (custom)</option>}
      </select>
    </Field>
  );
}
