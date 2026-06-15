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

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = offsetPart.match(/GMT([+-]?\d+)(?::(\d+))?/);
  if (!match || match[1] == null) return 0;
  const hours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + Math.sign(hours) * mins;
}

function formatIsoForTimezone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const offset = getTimezoneOffsetMinutes(timeZone, d);
  const adjusted = new Date(d.getTime() + offset * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function isoFromLocalAndTimezone(local: string, timeZone: string): string {
  const [datePart, timePart] = local.split("T");
  if (!datePart || !timePart) return new Date().toISOString();
  const [yStr, moStr, dStr] = datePart.split("-");
  const [hStr, miStr] = timePart.split(":");
  const y = parseInt(yStr ?? "0", 10);
  const mo = parseInt(moStr ?? "0", 10);
  const d = parseInt(dStr ?? "0", 10);
  const h = parseInt(hStr ?? "0", 10);
  const mi = parseInt(miStr ?? "0", 10);
  const browserDate = new Date(y, mo - 1, d, h, mi);
  const targetOffset = getTimezoneOffsetMinutes(timeZone, browserDate);
  const browserOffset = -browserDate.getTimezoneOffset();
  const diff = (browserOffset - targetOffset) * 60000;
  return new Date(browserDate.getTime() + diff).toISOString();
}

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

      {node.type === "on_schedule" &&
        (() => {
          const cfg = node.config as {
            intervalAmount?: number;
            intervalUnit?: "minute" | "hour" | "day" | "week" | "month";
            interval?: "minute" | "hour" | "day";
            startsAt: string;
            endsAt?: string;
            occurrences?: number;
            timeZone?: string;
            pauseAllowed?: boolean;
          };
          // Backward-compat: old flows used `interval` string
          const amount = cfg.intervalAmount ?? 1;
          const unit = cfg.intervalUnit ?? cfg.interval ?? "hour";
          const tz = cfg.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
          return (
            <>
              <Field label="Interval">
                <div className="flex gap-2">
                  <input
                    className="input w-20 text-right"
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => {
                      const v = Math.max(1, Math.floor(Number(e.target.value) || 1));
                      onChange({
                        ...node,
                        config: { ...cfg, intervalAmount: v, intervalUnit: unit, timeZone: tz },
                      } as FlowNode);
                    }}
                  />
                  <select
                    className="input flex-1"
                    value={unit}
                    onChange={(e) => {
                      const newUnit = e.target.value as typeof unit;
                      onChange({
                        ...node,
                        config: {
                          ...cfg,
                          intervalAmount: amount,
                          intervalUnit: newUnit,
                          timeZone: tz,
                        },
                      } as FlowNode);
                    }}
                  >
                    <option value="minute">Minute(s)</option>
                    <option value="hour">Hour(s)</option>
                    <option value="day">Day(s)</option>
                    <option value="week">Week(s)</option>
                    <option value="month">Month(s)</option>
                  </select>
                </div>
              </Field>
              <Field label="Timezone">
                <select
                  className="input"
                  value={tz}
                  onChange={(e) => {
                    const newTz = e.target.value;
                    const localStart = formatIsoForTimezone(cfg.startsAt, tz);
                    const atStart = isoFromLocalAndTimezone(localStart, newTz);
                    const next: typeof cfg = {
                      ...cfg,
                      startsAt: atStart,
                      timeZone: newTz,
                    };
                    if (cfg.endsAt) {
                      const localEnd = formatIsoForTimezone(cfg.endsAt, tz);
                      next.endsAt = isoFromLocalAndTimezone(localEnd, newTz);
                    }
                    onChange({ ...node, config: next } as FlowNode);
                  }}
                >
                  {TIMEZONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Starts at">
                <input
                  className="input"
                  type="datetime-local"
                  value={formatIsoForTimezone(cfg.startsAt, tz)}
                  onChange={(e) => {
                    const at = isoFromLocalAndTimezone(e.target.value, tz);
                    onChange({
                      ...node,
                      config: { ...cfg, startsAt: at, timeZone: tz },
                    } as FlowNode);
                  }}
                />
              </Field>
              <Field label="Ends at — optional">
                <div className="flex gap-1">
                  <input
                    className="input"
                    type="datetime-local"
                    value={cfg.endsAt ? formatIsoForTimezone(cfg.endsAt, tz) : ""}
                    onChange={(e) => {
                      const local = e.target.value;
                      onChange({
                        ...node,
                        config: {
                          ...cfg,
                          endsAt: local ? isoFromLocalAndTimezone(local, tz) : undefined,
                          occurrences: undefined,
                          timeZone: tz,
                        },
                      } as FlowNode);
                    }}
                  />
                  {cfg.endsAt && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...node,
                          config: { ...cfg, endsAt: undefined, timeZone: tz },
                        } as FlowNode)
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
                  value={cfg.occurrences ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      config: {
                        ...cfg,
                        endsAt: undefined,
                        occurrences: e.target.value ? Number(e.target.value) : undefined,
                        timeZone: tz,
                      },
                    } as FlowNode)
                  }
                />
              </Field>
              <Field label="Allow pause / resume">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.pauseAllowed ?? true}
                    onChange={(e) =>
                      onChange({
                        ...node,
                        config: { ...cfg, pauseAllowed: e.target.checked },
                      } as FlowNode)
                    }
                  />
                  <span className="text-xs text-zinc-400">
                    Allow pausing this stream after deployment
                  </span>
                </label>
              </Field>
            </>
          );
        })()}

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
            <Field label={`Amount per interval (${assetLabel(node.config.asset)})`}>
              <input
                className="input"
                value={
                  node.config.amountPerIntervalStroops
                    ? formatStroops(node.config.amountPerIntervalStroops)
                    : ""
                }
                placeholder="Amount released each interval"
                onChange={(e) => {
                  const stroops = tokenAmountToStroops(e.target.value);
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      amountPerIntervalStroops: stroops || undefined,
                    },
                  });
                }}
              />
              {node.config.amountPerIntervalStroops && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  = {stroopsToDisplay(node.config.amountPerIntervalStroops, node.config.asset)} per
                  interval
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

      {node.type === "email_notify" && (
        <>
          <EmailRecipientsField node={node} graph={graph} onChange={onChange} />
          <Field label="Subject">
            <input
              className="input"
              value={node.config.subject}
              placeholder="Payment notification"
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, subject: e.target.value },
                } as FlowNode)
              }
            />
          </Field>
          <Field label="Body">
            <textarea
              className="input"
              rows={5}
              value={node.config.body}
              placeholder="A payment of {{amount}} {{asset}} was received."
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, body: e.target.value },
                } as FlowNode)
              }
            />
          </Field>
          <EmailVariablesHint graph={graph} nodeId={node.id} />
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
                    config: {
                      kind: k,
                      at: new Date().toISOString(),
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
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
              <option value="amount_gt">amount ≥</option>
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
          {(node.config.kind === "time_after" || node.config.kind === "time_before") &&
            (() => {
              const cfg = node.config as {
                kind: "time_after" | "time_before";
                at: string;
                timeZone?: string;
              };
              const tz = cfg.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
              return (
                <>
                  <Field label="Date &amp; time">
                    <input
                      className="input"
                      type="datetime-local"
                      value={formatIsoForTimezone(cfg.at, tz)}
                      onChange={(e) => {
                        const local = e.target.value;
                        const at = isoFromLocalAndTimezone(local, tz);
                        const next =
                          cfg.kind === "time_after"
                            ? { kind: "time_after" as const, at, timeZone: tz }
                            : { kind: "time_before" as const, at, timeZone: tz };
                        onChange({ ...node, config: next } as FlowNode);
                      }}
                    />
                  </Field>
                  <Field label="Timezone">
                    <select
                      className="input"
                      value={tz}
                      onChange={(e) => {
                        const newTz = e.target.value;
                        const local = formatIsoForTimezone(cfg.at, tz);
                        const at = isoFromLocalAndTimezone(local, newTz);
                        const next =
                          cfg.kind === "time_after"
                            ? { kind: "time_after" as const, at, timeZone: newTz }
                            : { kind: "time_before" as const, at, timeZone: newTz };
                        onChange({ ...node, config: next } as FlowNode);
                      }}
                    >
                      {TIMEZONES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              );
            })()}
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

function EmailVariablesHint({ graph, nodeId }: { graph: FlowGraph; nodeId: string }) {
  const parentEdge = graph.edges.find((e) => e.target === nodeId);
  const parent = parentEdge ? graph.nodes.find((n) => n.id === parentEdge.source) : undefined;

  const variables = ["kind", "ledger", "txHash", "eventId", "walletAddress"];
  if (parent?.type === "condition") {
    if (parent.config.kind === "amount_gt" || parent.config.kind === "amount_lt") {
      variables.push("amount", "threshold", "condition");
    } else if (parent.config.kind === "oracle_gte") {
      variables.push("price", "amount", "threshold", "condition");
    } else if (parent.config.kind === "multisig") {
      variables.push("signer", "condition");
    } else {
      variables.push("condition");
    }
  } else {
    variables.push("amount", "asset", "from", "recipient");
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
      <div className="mb-1 font-medium text-zinc-300">Available variables</div>
      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <code key={v} className="rounded bg-zinc-800 px-1 py-0.5 text-[10px]">
            {"{{"}
            {v}
            {"}}"}
          </code>
        ))}
      </div>
    </div>
  );
}

function EmailRecipientsField({
  node,
  graph,
  onChange,
}: {
  node: Extract<FlowNode, { type: "email_notify" }>;
  graph: FlowGraph;
  onChange: (n: FlowNode) => void;
}) {
  const parentEdge = graph.edges.find((e) => e.target === node.id);
  const parent = parentEdge ? graph.nodes.find((n) => n.id === parentEdge.source) : undefined;
  const isSplit = parent?.type === "split";
  const placeholderAddress = parent?.type === "pay" ? parent.config.recipient : "_";

  let rows: { address: string; email: string }[];
  if (isSplit) {
    rows = parent.config.recipients.map((r) => ({
      address: r.address,
      email: node.config.recipients.find((e) => e.address === r.address)?.email ?? "",
    }));
  } else {
    rows = node.config.recipients.length
      ? node.config.recipients.map((r) => ({
          address: r.address || placeholderAddress,
          email: r.email,
        }))
      : [{ address: placeholderAddress, email: "" }];
  }

  const updateEmail = (idx: number, email: string) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, email: email.trim() } : r));
    onChange({ ...node, config: { ...node.config, recipients: next } } as FlowNode);
  };

  const addRow = () => {
    onChange({
      ...node,
      config: { ...node.config, recipients: [...rows, { address: placeholderAddress, email: "" }] },
    } as FlowNode);
  };

  const removeRow = (idx: number) => {
    onChange({
      ...node,
      config: { ...node.config, recipients: rows.filter((_, i) => i !== idx) },
    } as FlowNode);
  };

  return (
    <Field label="Recipients">
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {isSplit && (
              <input
                className="input flex-1 font-mono text-xs"
                value={r.address}
                placeholder="G..."
                readOnly
              />
            )}
            <input
              className="input flex-1 text-xs"
              value={r.email}
              placeholder="alice@example.com"
              onChange={(e) => updateEmail(idx, e.target.value)}
            />
            {!isSplit && rows.length > 1 && (
              <button
                type="button"
                className="px-1 text-zinc-500 hover:text-red-400"
                onClick={() => removeRow(idx)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {!isSplit && (
        <button
          type="button"
          className="mt-2 rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
          onClick={addRow}
        >
          + Add recipient
        </button>
      )}
      {isSplit && (
        <div className="mt-1 text-xs text-zinc-500">
          One email is required for each split recipient.
        </div>
      )}
    </Field>
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
