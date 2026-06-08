"use client";

import type { FlowNode, FlowGraph, Asset } from "@/lib/flows/schema";
import {
  isPendingAddress,
  bpsToPct,
  pctToBps,
  sourceAmountStroops,
  isTrigger,
  TOTAL_BPS,
  assetLabel,
  stroopsToDisplay,
  tokenAmountToStroops,
} from "@/lib/flows/schema";
import { cn, formatStroops } from "@/lib/utils";

type Props = {
  node: FlowNode | null;
  graph: FlowGraph;
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
  className?: string;
};

export default function ConfigPanel({ node, graph, onChange, onDelete, className }: Props) {
  if (!node) {
    return (
      <aside
        className={cn("border-l border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400", className)}
      >
        Select a block on the canvas to edit it.
      </aside>
    );
  }

  const trigger = graph.nodes.find(isTrigger);
  const triggerType = trigger?.type ?? null;
  const sourceAmount = sourceAmountStroops(graph);

  return (
    <aside
      className={cn(
        "space-y-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 text-sm",
        className,
      )}
    >
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
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label={`Minimum amount (${assetLabel(node.config.asset)}), optional`}>
            <input
              className="input font-mono"
              value={
                node.config.minAmountStroops ? formatStroops(node.config.minAmountStroops) : ""
              }
              placeholder="Any amount"
              onChange={(e) => {
                const stroops = tokenAmountToStroops(e.target.value);
                onChange({
                  ...node,
                  config: { ...node.config, minAmountStroops: stroops || undefined },
                });
              }}
            />
            {node.config.minAmountStroops && (
              <div className="mt-0.5 text-[11px] text-zinc-500">
                ≥ {stroopsToDisplay(node.config.minAmountStroops, node.config.asset)}
              </div>
            )}
          </Field>
        </>
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
              type="datetime-local"
              value={node.config.startsAt.slice(0, 16)}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, startsAt: new Date(e.target.value).toISOString() },
                })
              }
            />
          </Field>
          <Field label="Ends at — optional">
            <div className="flex gap-1">
              <input
                className="input"
                type="datetime-local"
                value={node.config.endsAt?.slice(0, 16) ?? ""}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      occurrences: undefined,
                    },
                  })
                }
              />
              {node.config.endsAt && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...node,
                      config: { ...node.config, endsAt: undefined },
                    })
                  }
                  className="rounded border border-zinc-700 px-2 text-zinc-400 hover:text-red-300"
                >
                  ×
                </button>
              )}
            </div>
          </Field>
          <Field label="Occurrences — optional">
            <input
              className="input"
              type="number"
              min="1"
              placeholder="e.g. 5"
              value={node.config.occurrences ?? ""}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    endsAt: undefined,
                    occurrences: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </Field>
        </>
      )}

      {node.type === "pay" && (
        <>
          <Field label="Recipient (G… or PENDING:)">
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

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={node.config.fullAmount}
              onChange={(e) => {
                const fullAmount = e.target.checked;
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    fullAmount,
                    mode: fullAmount ? "percentage" : (node.config.mode ?? "fixed"),
                    percentage: fullAmount ? 100 : node.config.percentage,
                  },
                } as FlowNode);
              }}
            />
            <span className="text-xs text-zinc-400">Send full amount</span>
          </label>

          {!node.config.fullAmount && (
            <>
              <Field label="Mode">
                <select
                  className="input"
                  value={node.config.mode}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      config: {
                        ...node.config,
                        mode: e.target.value as "fixed" | "percentage",
                      },
                    } as FlowNode)
                  }
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="percentage">Percentage</option>
                </select>
              </Field>

              {node.config.mode === "fixed" && (
                <Field label={`Amount (${assetLabel(node.config.asset)})`}>
                  <input
                    className="input"
                    value={
                      node.config.amountStroops ? formatStroops(node.config.amountStroops) : ""
                    }
                    onChange={(e) =>
                      onChange({
                        ...node,
                        config: {
                          ...node.config,
                          amountStroops: tokenAmountToStroops(e.target.value),
                        },
                      })
                    }
                  />
                  {node.config.amountStroops && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      = {stroopsToDisplay(node.config.amountStroops, node.config.asset)}
                    </div>
                  )}
                </Field>
              )}

              {node.config.mode === "percentage" && (
                <Field label="Percentage">
                  <div className="relative">
                    <input
                      className="input pr-6"
                      type="number"
                      min={0}
                      max={100}
                      value={node.config.percentage ?? ""}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onChange({
                          ...node,
                          config: {
                            ...node.config,
                            percentage: isNaN(v) ? 0 : Math.min(100, Math.max(0, v)),
                          },
                        });
                      }}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-zinc-500">
                      %
                    </span>
                  </div>
                </Field>
              )}
            </>
          )}

          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
        </>
      )}

      {node.type === "split" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />

          {triggerType === "on_schedule" && (
            <Field label={`Rate (${assetLabel(node.config.asset)}/s)`}>
              <input
                className="input"
                value={
                  node.config.ratePerSecondStroops
                    ? formatStroops(node.config.ratePerSecondStroops)
                    : ""
                }
                placeholder="Per-second streaming rate"
                onChange={(e) => {
                  const stroops = tokenAmountToStroops(e.target.value);
                  onChange({
                    ...node,
                    config: { ...node.config, ratePerSecondStroops: stroops || undefined },
                  });
                }}
              />
              {node.config.ratePerSecondStroops && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  = {stroopsToDisplay(node.config.ratePerSecondStroops, node.config.asset)}/s
                </div>
              )}
            </Field>
          )}

          <div className="text-xs text-zinc-400">Recipients (shares must sum to 100%)</div>

          <AllocationBar recipients={node.config.recipients} />

          {node.config.recipients.map((r, i) => {
            const isPending = isPendingAddress(r.address);
            const pct = bpsToPct(r.bps);
            const pctDisplay = pct === Math.floor(pct) ? `${pct}` : `${pct.toFixed(1)}`;
            const totalBps = node.config.recipients.reduce((s, r2) => s + r2.bps, 0);
            const projected =
              sourceAmount && totalBps === TOTAL_BPS
                ? stroopsToDisplay(
                    ((BigInt(sourceAmount) * BigInt(r.bps)) / 10000n).toString(),
                    node.config.asset,
                  )
                : null;

            return (
              <div key={i} className="space-y-1 rounded border border-zinc-800 bg-zinc-900/50 p-2">
                <div className="grid grid-cols-[1fr_64px_28px] items-center gap-1">
                  <div className="grid gap-0.5">
                    <input
                      className="input font-mono text-xs"
                      value={r.address}
                      placeholder="G... or PENDING:label"
                      onChange={(e) => {
                        const next = [...node.config.recipients];
                        next[i] = { ...r, address: e.target.value.trim() };
                        onChange({
                          ...node,
                          config: { ...node.config, recipients: next },
                        } as FlowNode);
                      }}
                    />
                  </div>
                  <div className="relative">
                    <input
                      className="input pr-5 text-right"
                      value={pctDisplay}
                      placeholder="0"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const next = [...node.config.recipients];
                        next[i] = {
                          ...r,
                          bps: isNaN(v) ? 0 : Math.min(10000, Math.max(0, pctToBps(v))),
                        };
                        onChange({
                          ...node,
                          config: { ...node.config, recipients: next },
                        } as FlowNode);
                      }}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[11px] text-zinc-500">
                      %
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const next = node.config.recipients.filter((_, j) => j !== i);
                      onChange({
                        ...node,
                        config: { ...node.config, recipients: next },
                      } as FlowNode);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <input
                    className="input text-xs"
                    value={r.label ?? ""}
                    placeholder="Label (e.g. Alice)"
                    onChange={(e) => {
                      const next = [...node.config.recipients];
                      next[i] = { ...r, label: e.target.value || undefined };
                      onChange({
                        ...node,
                        config: { ...node.config, recipients: next },
                      } as FlowNode);
                    }}
                  />
                  <div className="flex items-center gap-1 text-[10px]">
                    {isPending && (
                      <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-400">
                        needs address
                      </span>
                    )}
                    {projected && (
                      <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        {projected}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {remainingPct(node.config.recipients) > 0 && (
            <div className="text-xs text-amber-400">
              Remaining: {remainingPct(node.config.recipients).toFixed(1)}% unallocated
            </div>
          )}

          {node.config.recipients.reduce((s, r) => s + r.bps, 0) > TOTAL_BPS && (
            <div className="text-xs text-red-400">
              Total exceeds 100% by{" "}
              {((node.config.recipients.reduce((s, r) => s + r.bps, 0) - TOTAL_BPS) / 100).toFixed(
                1,
              )}
              %
            </div>
          )}

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
                      bps: 100,
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

      {node.type === "webhook" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Relayer address (G… or PENDING:)">
            <div className="relative">
              <input
                className={`input font-mono ${isPendingAddress(node.config.relayer) ? "ring-1 ring-amber-700" : ""}`}
                value={node.config.relayer}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: { ...node.config, relayer: e.target.value.trim() },
                  })
                }
              />
              {isPendingAddress(node.config.relayer) && (
                <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
                  needs address
                </span>
              )}
            </div>
          </Field>
        </>
      )}

      {node.type === "web2_webhook" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
            The app backend will act as the relayer. After deployment, you will receive a webhook
            URL and secret token.
          </div>
        </>
      )}

      {node.type === "subscription" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Subscriber address (G… or PENDING:)">
            <div className="relative">
              <input
                className={`input font-mono ${isPendingAddress(node.config.subscriber) ? "ring-1 ring-amber-700" : ""}`}
                value={node.config.subscriber}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: { ...node.config, subscriber: e.target.value.trim() },
                  })
                }
              />
              {isPendingAddress(node.config.subscriber) && (
                <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
                  needs address
                </span>
              )}
            </div>
          </Field>
          <Field label={`Amount per period (${assetLabel(node.config.asset)})`}>
            <input
              className="input"
              value={formatStroops(node.config.amountPerPeriodStroops)}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    amountPerPeriodStroops: tokenAmountToStroops(e.target.value),
                  },
                })
              }
            />
          </Field>
        </>
      )}

      {node.type === "oracle" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Price threshold">
            <input
              className="input"
              value={node.config.threshold}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    threshold: e.target.value.replace(/\D/g, ""),
                  },
                })
              }
            />
          </Field>
        </>
      )}

      {node.type === "swap" && (
        <>
          <Field label="Asset In">
            <AssetSimpleSelect
              asset={node.config.assetIn}
              onChange={(assetIn) =>
                onChange({ ...node, config: { ...node.config, assetIn } } as FlowNode)
              }
            />
          </Field>
          <Field label="Asset Out">
            <AssetSimpleSelect
              asset={node.config.assetOut}
              onChange={(assetOut) =>
                onChange({ ...node, config: { ...node.config, assetOut } } as FlowNode)
              }
            />
          </Field>
          <Field label="Rate (basis points, 1–10000)">
            <input
              className="input"
              type="number"
              min={1}
              max={10000}
              value={node.config.rateBps}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    rateBps: isNaN(v) ? 1 : Math.min(10000, Math.max(1, v)),
                  },
                });
              }}
            />
            <div className="mt-0.5 text-[11px] text-zinc-500">
              = {(node.config.rateBps / 100).toFixed(0)}%
            </div>
          </Field>
        </>
      )}

      {node.type === "yield" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Vault address (G… or PENDING:)">
            <div className="relative">
              <input
                className={`input font-mono ${isPendingAddress(node.config.vault) ? "ring-1 ring-amber-700" : ""}`}
                value={node.config.vault}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: { ...node.config, vault: e.target.value.trim() },
                  })
                }
              />
              {isPendingAddress(node.config.vault) && (
                <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
                  needs address
                </span>
              )}
            </div>
          </Field>
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
                  onChange({ ...node, config: { kind: k, amountStroops: "10000000" } } as FlowNode);
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
                  onChange({
                    ...node,
                    config: { kind: k, at: new Date().toISOString() },
                  } as FlowNode);
                } else if (k === "multisig") {
                  onChange({
                    ...node,
                    config: {
                      kind: "multisig",
                      signers: ["PENDING:signer1"],
                      threshold: 1,
                    },
                  });
                }
              }}
            >
              <option value="amount_gt">amount &gt;</option>
              <option value="amount_lt">amount &lt;</option>
              <option value="oracle_gte">oracle ≥ threshold</option>
              <option value="time_after">time after</option>
              <option value="time_before">time before</option>
              <option value="multisig">multisig</option>
            </select>
          </Field>
          {(node.config.kind === "amount_gt" || node.config.kind === "amount_lt") && (
            <Field label="Threshold">
              <input
                className="input"
                value={formatStroops(node.config.amountStroops)}
                onChange={(e) => {
                  const stroops = tokenAmountToStroops(e.target.value);
                  const next =
                    node.config.kind === "amount_gt"
                      ? { kind: "amount_gt" as const, amountStroops: stroops }
                      : { kind: "amount_lt" as const, amountStroops: stroops };
                  onChange({ ...node, config: next } as FlowNode);
                }}
              />
              {trigger?.type === "on_receive" && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  = {stroopsToDisplay(node.config.amountStroops, trigger.config.asset)}
                </div>
              )}
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
                    onChange({ ...node, config: cfg } as FlowNode);
                  }}
                />
              </Field>
              <Field label="Storage key">
                <input
                  className="input"
                  value={node.config.key}
                  onChange={(e) => {
                    const cfg = { ...node.config, key: e.target.value };
                    onChange({ ...node, config: cfg } as FlowNode);
                  }}
                />
              </Field>
              <Field label="Threshold">
                <input
                  className="input"
                  value={node.config.threshold}
                  onChange={(e) => {
                    const cfg = { ...node.config, threshold: e.target.value.replace(/\D/g, "") };
                    onChange({ ...node, config: cfg } as FlowNode);
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
                  onChange({ ...node, config: next } as FlowNode);
                }}
              />
            </Field>
          )}
          {node.config.kind === "multisig" &&
            (() => {
              const cfg = node.config as Extract<typeof node.config, { kind: "multisig" }>;
              return (
                <>
                  <Field label="Signers">
                    {cfg.signers.map((s, i) => (
                      <div key={i} className="mb-1 flex gap-1">
                        <input
                          className={`input font-mono text-xs ${isPendingAddress(s) ? "ring-1 ring-amber-700" : ""}`}
                          value={s}
                          placeholder="G... or PENDING:label"
                          onChange={(e) => {
                            const next = [...cfg.signers];
                            next[i] = e.target.value.trim();
                            onChange({ ...node, config: { ...cfg, signers: next } } as FlowNode);
                          }}
                        />
                        <button
                          onClick={() => {
                            const next = cfg.signers.filter((_, j) => j !== i);
                            onChange({ ...node, config: { ...cfg, signers: next } } as FlowNode);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-400 hover:text-red-300"
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
                          config: { ...cfg, signers: [...cfg.signers, "PENDING:signer"] },
                        } as FlowNode)
                      }
                    >
                      + Add signer
                    </button>
                  </Field>
                  <Field label="Threshold (min signers)">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={cfg.signers.length}
                      value={cfg.threshold}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onChange({
                          ...node,
                          config: {
                            ...cfg,
                            threshold: isNaN(v) ? 1 : Math.min(cfg.signers.length, Math.max(1, v)),
                          },
                        } as FlowNode);
                      }}
                    />
                  </Field>
                </>
              );
            })()}
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
          color: #e4e4e7;
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

function AssetSimpleSelect({
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
  );
}

function remainingPct(recipients: Array<{ bps: number }>): number {
  const used = recipients.reduce((s, r) => s + r.bps, 0);
  return Math.max(0, (TOTAL_BPS - used) / 100);
}

function AllocationBar({ recipients }: { recipients: Array<{ bps: number; label?: string }> }) {
  const total = recipients.reduce((s, r) => s + r.bps, 0);
  const colors = [
    "#a78bfa",
    "#34d399",
    "#60a5fa",
    "#fbbf24",
    "#f472b6",
    "#fb923c",
    "#22d3ee",
    "#e879f9",
  ];

  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
      {recipients.map((r, i) => {
        const w = total > 0 ? (r.bps / total) * 100 : 0;
        if (w <= 0) return null;
        return (
          <div
            key={i}
            className="h-full transition-all duration-200"
            style={{
              width: `${w}%`,
              backgroundColor: colors[i % colors.length]!,
            }}
            title={`${r.label ?? `Recipient ${i + 1}`}: ${bpsToPct(r.bps)}%`}
          />
        );
      })}
      {total < TOTAL_BPS && (
        <div
          className="h-full bg-zinc-700 transition-all duration-200"
          style={{ width: `${((TOTAL_BPS - total) / TOTAL_BPS) * 100}%` }}
        />
      )}
    </div>
  );
}
