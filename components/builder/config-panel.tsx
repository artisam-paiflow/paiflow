"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  splitTotalFixedStroops,
  type SplitRecipient,
} from "@/lib/flows/schema";
import { cn, formatStroops, shortAddr } from "@/lib/utils";
import AddressInput from "./address-input";
import type { AddressEntry } from "@/lib/address-book.types";
import {
  computeAssetFlow,
  assetsEqual,
  validateFlow,
  FIAT_PAYOUT_TRIGGERS,
} from "@/lib/flows/validate";

/**
 * Sentinel for an address field a developer chose to leave blank at design time
 * and fill via the API after deploy (dev mode only). It is a `PENDING:` value, so
 * `isPendingAddress` recognizes it and the deploy resolver encodes it as a blank
 * (`None` / `ScVal::Void`) on the matching `_DEV` contract.
 */
const API_FILL_ADDRESS = "PENDING:__api__";
function isApiFillAddress(addr: string): boolean {
  return addr === API_FILL_ADDRESS;
}

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
  addressBook?: AddressEntry[];
  refreshAddressBook?: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  className?: string;
  /**
   * Hide the internal node-type label + Delete header row. Set when the floating
   * wrapper renders its own draggable header with the title and Delete control,
   * so the title isn't duplicated.
   */
  hideHeader?: boolean;
};

export default function ConfigPanel({
  node,
  graph,
  onChange,
  onDelete,
  addressBook = [],
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  className,
  hideHeader = false,
}: Props) {
  const expectedAsset = useMemo(
    () => (node ? (computeAssetFlow(graph).get(node.id) ?? null) : null),
    [graph, node],
  );

  // Validation issues belonging to this node, split into per-field messages
  // (keyed by config path, e.g. "recipient" or "recipients.0.address") and
  // node-level messages with no single field to attach to. Schema (zod) paths
  // index nodes positionally (`nodes.0.config…`) while semantic rules key by
  // node id (`nodes.<id>.…`); both are normalized here.
  const nodeErrors = useMemo(() => {
    const field = new Map<string, string>();
    const general: string[] = [];
    if (!node) return { field, general };
    const result = validateFlow(graph);
    if (result.ok) return { field, general };
    const idx = graph.nodes.findIndex((n) => n.id === node.id);
    for (const issue of result.errors) {
      const seg = issue.path.split(".");
      const key = seg[0] === "nodes" ? seg[1] : undefined;
      const isThisNode =
        key === node.id || (key !== undefined && /^\d+$/.test(key) && Number(key) === idx);
      if (!isThisNode) continue;
      if (seg[2] === "config" && seg.length > 3) {
        const fieldPath = seg.slice(3).join(".");
        if (!field.has(fieldPath)) field.set(fieldPath, issue.friendlyMessage);
      } else {
        general.push(issue.friendlyMessage);
      }
    }
    return { field, general };
  }, [graph, node]);

  const fieldError = (name: string): string | null => nodeErrors.field.get(name) ?? null;

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
  const devMode = graph.devMode === true;

  // Native fiat payout (bank transfer via an auto-generated cash-out contract)
  // is available on pay/split nodes for non-dev flows whose payouts route
  // through the payer/splitter. Payroll also allows it in dev mode (bank
  // details are filled via the API after deploy).
  const fiatPayoutAvailable =
    triggerType === "payroll" ||
    (!devMode && triggerType !== null && FIAT_PAYOUT_TRIGGERS.has(triggerType));

  // Payroll distributions must be fixed salary amounts. If a user switches an
  // existing percentage split to a payroll trigger, convert the recipients to
  // fixed amounts so the UI stays consistent and the flow can validate.
  useEffect(() => {
    if (triggerType !== "payroll" || node.type !== "split") return;
    const hasPercentage = node.config.recipients.some((r) => r.mode === "percentage");
    if (!hasPercentage) return;
    onChange({
      ...node,
      config: {
        ...node.config,
        recipients: node.config.recipients.map((r) =>
          r.mode === "percentage"
            ? {
                address: r.address,
                label: r.label,
                payoutMode: r.payoutMode,
                accountName: r.accountName,
                accountNumber: r.accountNumber,
                bankCode: r.bankCode,
                mode: "fixed" as const,
                amountStroops: "0",
              }
            : r,
        ),
      },
    } as FlowNode);
  }, [triggerType, node, onChange]);

  // Streamer (on_schedule) distributes by percentage only — the contract's
  // Recipient.amount field is dead weight. If a user switches an existing
  // fixed-amount split to an on_schedule trigger, convert to percentage mode,
  // deriving initial shares proportionally from the amounts so intent is
  // preserved (dust goes to the last recipient).
  useEffect(() => {
    if (triggerType !== "on_schedule" || node.type !== "split") return;
    const fixedRecipients = node.config.recipients.filter((r) => r.mode === "fixed");
    if (fixedRecipients.length === 0) return;
    const total = fixedRecipients.reduce((s, r) => s + BigInt(r.amountStroops), 0n);
    let allocated = 0;
    onChange({
      ...node,
      config: {
        ...node.config,
        recipients: node.config.recipients.map((r, i) => {
          const base = {
            address: r.address,
            label: r.label,
            payoutMode: r.payoutMode,
            accountName: r.accountName,
            accountNumber: r.accountNumber,
            bankCode: r.bankCode,
          };
          if (r.mode !== "fixed") {
            return { ...base, mode: "percentage" as const, bps: 0 };
          }
          const isLast = i === node.config.recipients.length - 1;
          const bps =
            total > 0n
              ? isLast
                ? 10_000 - allocated
                : Number((BigInt(r.amountStroops) * 10_000n) / total)
              : 0;
          allocated += bps;
          return { ...base, mode: "percentage" as const, bps };
        }),
      },
    } as FlowNode);
  }, [triggerType, node, onChange]);

  return (
    <aside
      className={cn(
        // Render at natural full height (no internal scrollbar / height cap):
        // a tall panel (e.g. the splitter) is brought into view by panning the
        // canvas or dragging the panel header, not by scrolling inside it.
        "space-y-4 border-l border-zinc-800 bg-zinc-950 p-4 text-sm",
        className,
      )}
    >
      {!hideHeader && (
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
      )}

      {nodeErrors.general.length > 0 && (
        <div
          role="alert"
          className="border-error/40 bg-error-container/20 space-y-1 rounded border px-3 py-2"
        >
          {nodeErrors.general.map((m, i) => (
            <p key={i} className="text-error text-[11px] leading-snug">
              {m}
            </p>
          ))}
        </div>
      )}

      {node.type === "on_receive" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field
            label={`Minimum amount (${assetLabel(node.config.asset)}), optional`}
            error={fieldError("minAmountStroops")}
          >
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
            retrieveAllowed?: boolean;
          };
          // Backward-compat: old flows used `interval` string
          const amount = cfg.intervalAmount ?? 1;
          const unit = cfg.intervalUnit ?? cfg.interval ?? "hour";
          const tz = cfg.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
          return (
            <>
              <Field label="Interval" error={fieldError("intervalAmount")}>
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
              <Field label="Starts at" error={fieldError("startsAt")}>
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
              <Field label="Ends at — optional" error={fieldError("endsAt")}>
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
              <Field label="Occurrences — optional" error={fieldError("occurrences")}>
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
                        config: {
                          ...cfg,
                          pauseAllowed: e.target.checked,
                          retrieveAllowed: e.target.checked ? cfg.retrieveAllowed : false,
                        },
                      } as FlowNode)
                    }
                  />
                  <span className="text-xs text-zinc-400">
                    Allow pausing this stream after deployment
                  </span>
                </label>
              </Field>
              <Field label="Allow retrieve unvested">
                <label
                  className={`flex items-center gap-2 ${!(cfg.pauseAllowed ?? true) ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={(cfg.pauseAllowed ?? true) && (cfg.retrieveAllowed ?? false)}
                    disabled={!(cfg.pauseAllowed ?? true)}
                    onChange={(e) =>
                      onChange({
                        ...node,
                        config: { ...cfg, retrieveAllowed: e.target.checked },
                      } as FlowNode)
                    }
                  />
                  <span className="text-xs text-zinc-400">
                    Allow admin to retrieve unvested funds while paused
                  </span>
                </label>
              </Field>
            </>
          );
        })()}

      {node.type === "pay" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
            expectedAsset={expectedAsset}
          />

          {!(fiatPayoutAvailable && node.config.payoutMode === "fiat") && (
            <ApiFillField
              label="Recipient (G… or PENDING:)"
              devMode={devMode}
              active={isApiFillAddress(node.config.recipient)}
              onActivate={() =>
                onChange({ ...node, config: { ...node.config, recipient: API_FILL_ADDRESS } })
              }
              onDeactivate={() => onChange({ ...node, config: { ...node.config, recipient: "" } })}
              hint="Recipient set via the API after deploy"
              error={fieldError("recipient")}
            >
              <AddressInput
                value={node.config.recipient}
                onChange={(recipient) =>
                  onChange({
                    ...node,
                    config: { ...node.config, recipient },
                  })
                }
                pending={isPendingAddress(node.config.recipient)}
                error={!!fieldError("recipient")}
                addressBook={addressBook}
                onAddressBookChange={refreshAddressBook}
                addressBookLoading={addressBookLoading}
                addressBookError={addressBookError}
              />
            </ApiFillField>
          )}

          {fiatPayoutAvailable && (
            <div className="space-y-2 pt-1">
              <Field label="Payout mode">
                <select
                  className="input text-xs"
                  value={node.config.payoutMode ?? "crypto"}
                  onChange={(e) => {
                    const mode = e.target.value as "crypto" | "fiat";
                    onChange({
                      ...node,
                      config: {
                        ...node.config,
                        payoutMode: mode,
                        // Fiat payouts get an auto-generated cash-out contract,
                        // so the wallet address is replaced with a sentinel —
                        // like fiat split recipients.
                        recipient:
                          mode === "fiat"
                            ? "PENDING:fiat"
                            : isPendingAddress(node.config.recipient)
                              ? "PENDING:unnamed"
                              : node.config.recipient,
                        ...(mode === "fiat" && !devMode
                          ? {
                              accountName: node.config.accountName ?? "",
                              accountNumber: node.config.accountNumber ?? "",
                              bankCode: node.config.bankCode ?? "",
                            }
                          : {}),
                      },
                    } as FlowNode);
                  }}
                >
                  <option value="crypto">Crypto (wallet)</option>
                  <option value="fiat">Fiat (bank transfer)</option>
                </select>
              </Field>

              {node.config.payoutMode === "fiat" && !devMode && (
                <>
                  <Field label="Account name" error={fieldError("accountName")}>
                    <input
                      className="input text-xs"
                      value={node.config.accountName ?? ""}
                      placeholder="Juan Dela Cruz"
                      onChange={(e) =>
                        onChange({
                          ...node,
                          config: { ...node.config, accountName: e.target.value },
                        } as FlowNode)
                      }
                    />
                  </Field>
                  <Field label="Account number" error={fieldError("accountNumber")}>
                    <input
                      className="input text-xs"
                      value={node.config.accountNumber ?? ""}
                      placeholder="1234567890"
                      onChange={(e) =>
                        onChange({
                          ...node,
                          config: { ...node.config, accountNumber: e.target.value },
                        } as FlowNode)
                      }
                    />
                  </Field>
                  <Field label="Bank" error={fieldError("bankCode")}>
                    <select
                      className="input text-xs"
                      value={node.config.bankCode ?? ""}
                      onChange={(e) =>
                        onChange({
                          ...node,
                          config: { ...node.config, bankCode: e.target.value },
                        } as FlowNode)
                      }
                    >
                      <option value="">— select bank —</option>
                      <option value="BASECPH">BASECPH — BDO</option>
                      <option value="BACTBPH">BACTBPH — BPI</option>
                    </select>
                  </Field>
                </>
              )}

              {node.config.payoutMode === "fiat" && devMode && (
                <div className="rounded border border-amber-800/40 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-300">
                  Bank details configured via API after deploy.
                </div>
              )}
            </div>
          )}

          {devMode && (
            <label className="flex cursor-pointer items-center justify-between rounded border border-amber-800/40 bg-amber-950/10 px-3 py-2">
              <span className="text-xs text-amber-300">
                Fill payment value via API after deploy
              </span>
              <input
                type="checkbox"
                checked={node.config.fillValueViaApi}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: { ...node.config, fillValueViaApi: e.target.checked },
                  } as FlowNode)
                }
              />
            </label>
          )}

          {node.config.fillValueViaApi ? (
            <div className="flex items-center gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 font-mono text-[12px] text-amber-300">
              <span className="material-symbols-outlined text-[14px]">tune</span>
              Payment value set via the API after deploy
            </div>
          ) : (
            <>
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
                    <Field
                      label={`Amount (${assetLabel(node.config.asset)})`}
                      error={fieldError("amountStroops")}
                    >
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
                    <Field label="Percentage" error={fieldError("percentage")}>
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
            </>
          )}
        </>
      )}

      {node.type === "split" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
            expectedAsset={expectedAsset}
          />

          {devMode && (
            <label className="flex cursor-pointer items-center justify-between rounded border border-amber-800/40 bg-amber-950/10 px-3 py-2">
              <span className="text-xs text-amber-300">Fill recipients via API after deploy</span>
              <input
                type="checkbox"
                checked={node.config.recipients.length === 0}
                onChange={(e) =>
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      recipients: e.target.checked
                        ? []
                        : [{ address: "", mode: "percentage" as const, bps: 0 }],
                    },
                  } as FlowNode)
                }
              />
            </label>
          )}

          {devMode && node.config.recipients.length === 0 ? (
            <div className="flex items-center gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 font-mono text-[12px] text-amber-300">
              <span className="material-symbols-outlined text-[14px]">tune</span>
              Recipients set via the API after deploy
            </div>
          ) : (
            <></>
          )}

          {triggerType === "on_schedule" && (
            <Field
              label={`Amount per interval (${assetLabel(node.config.asset)})`}
              error={fieldError("amountPerIntervalStroops")}
            >
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

          {node.type === "split" && (
            <SplitRecipientsEditor
              node={node as Extract<FlowNode, { type: "split" }>}
              trigger={trigger}
              sourceAmount={sourceAmount}
              devMode={devMode}
              addressBook={addressBook}
              refreshAddressBook={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
              fieldErrors={nodeErrors.field}
              onChange={onChange}
            />
          )}
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
          <Field label="Relayer address (G… or PENDING:)" error={fieldError("relayer")}>
            <AddressInput
              value={node.config.relayer}
              onChange={(relayer) =>
                onChange({
                  ...node,
                  config: { ...node.config, relayer },
                })
              }
              pending={isPendingAddress(node.config.relayer)}
              error={!!fieldError("relayer")}
              addressBook={addressBook}
              onAddressBookChange={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
            />
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
          <ApiFillField
            label="Subscriber address (G… or PENDING:)"
            devMode={devMode}
            active={isApiFillAddress(node.config.subscriber)}
            onActivate={() =>
              onChange({ ...node, config: { ...node.config, subscriber: API_FILL_ADDRESS } })
            }
            onDeactivate={() => onChange({ ...node, config: { ...node.config, subscriber: "" } })}
            hint="Subscriber set via the API after deploy"
            error={fieldError("subscriber")}
          >
            <AddressInput
              value={node.config.subscriber}
              onChange={(subscriber) =>
                onChange({
                  ...node,
                  config: { ...node.config, subscriber },
                })
              }
              pending={isPendingAddress(node.config.subscriber)}
              error={!!fieldError("subscriber")}
              addressBook={addressBook}
              onAddressBookChange={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
            />
          </ApiFillField>
          <Field
            label={`Amount per period (${assetLabel(node.config.asset)})`}
            error={fieldError("amountPerPeriodStroops")}
          >
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
            <ApiFillHint
              show={
                devMode &&
                (!node.config.amountPerPeriodStroops || node.config.amountPerPeriodStroops === "0")
              }
            >
              Leave empty to set the amount via the API after deploy.
            </ApiFillHint>
          </Field>
          {(() => {
            const cfg = node.config as {
              intervalAmount?: number;
              intervalUnit?: "minute" | "hour" | "day" | "week" | "month";
              endsAt?: string;
              occurrences?: number;
            };
            const amount = cfg.intervalAmount ?? 1;
            const unit = cfg.intervalUnit ?? "day";
            return (
              <>
                <Field label="Interval" error={fieldError("intervalAmount")}>
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
                          config: { ...cfg, intervalAmount: v, intervalUnit: unit },
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
                          config: { ...cfg, intervalAmount: amount, intervalUnit: newUnit },
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
                <Field label="Ends at — optional" error={fieldError("endsAt")}>
                  <div className="flex gap-1">
                    <input
                      className="input"
                      type="datetime-local"
                      value={
                        cfg.endsAt
                          ? formatIsoForTimezone(
                              cfg.endsAt,
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                            )
                          : ""
                      }
                      onChange={(e) => {
                        const local = e.target.value;
                        onChange({
                          ...node,
                          config: {
                            ...cfg,
                            endsAt: local
                              ? isoFromLocalAndTimezone(
                                  local,
                                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                                )
                              : undefined,
                            occurrences: undefined,
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
                            config: { ...cfg, endsAt: undefined },
                          } as FlowNode)
                        }
                        className="rounded border border-zinc-700 px-2 text-zinc-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </Field>
                <Field label="Occurrences — optional" error={fieldError("occurrences")}>
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
                        },
                      } as FlowNode)
                    }
                  />
                </Field>
              </>
            );
          })()}
        </>
      )}

      {node.type === "payroll" && (
        <>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <ApiFillField
            label="Employer address (G… or PENDING:)"
            devMode={devMode}
            active={isApiFillAddress(node.config.employer)}
            onActivate={() =>
              onChange({ ...node, config: { ...node.config, employer: API_FILL_ADDRESS } })
            }
            onDeactivate={() => onChange({ ...node, config: { ...node.config, employer: "" } })}
            hint="Employer set via the API after deploy"
            error={fieldError("employer")}
          >
            <AddressInput
              value={node.config.employer}
              onChange={(employer) =>
                onChange({
                  ...node,
                  config: { ...node.config, employer },
                })
              }
              pending={isPendingAddress(node.config.employer)}
              error={!!fieldError("employer")}
              addressBook={addressBook}
              onAddressBookChange={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
            />
          </ApiFillField>
          {(() => {
            const cfg = node.config as {
              intervalAmount?: number;
              intervalUnit?: "minute" | "hour" | "day" | "week" | "month";
              endsAt?: string;
              occurrences?: number;
              fillScheduleViaApi?: boolean;
            };
            const amount = cfg.intervalAmount ?? 1;
            const unit = cfg.intervalUnit ?? "week";
            return (
              <>
                {devMode && (
                  <label className="flex cursor-pointer items-center justify-between rounded border border-amber-800/40 bg-amber-950/10 px-3 py-2">
                    <span className="text-xs text-amber-300">
                      Fill schedule via API after deploy
                    </span>
                    <input
                      type="checkbox"
                      checked={cfg.fillScheduleViaApi ?? false}
                      onChange={(e) =>
                        onChange({
                          ...node,
                          config: { ...cfg, fillScheduleViaApi: e.target.checked },
                        } as FlowNode)
                      }
                    />
                  </label>
                )}

                {devMode && cfg.fillScheduleViaApi ? (
                  <div className="flex items-center gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 font-mono text-[12px] text-amber-300">
                    <span className="material-symbols-outlined text-[14px]">tune</span>
                    Schedule set via the API after deploy
                  </div>
                ) : (
                  <>
                    <Field label="Interval" error={fieldError("intervalAmount")}>
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
                              config: { ...cfg, intervalAmount: v, intervalUnit: unit },
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
                              config: { ...cfg, intervalAmount: amount, intervalUnit: newUnit },
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
                    <Field label="Ends at — optional" error={fieldError("endsAt")}>
                      <div className="flex gap-1">
                        <input
                          className="input"
                          type="datetime-local"
                          value={
                            cfg.endsAt
                              ? formatIsoForTimezone(
                                  cfg.endsAt,
                                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                                )
                              : ""
                          }
                          onChange={(e) => {
                            const local = e.target.value;
                            onChange({
                              ...node,
                              config: {
                                ...cfg,
                                endsAt: local
                                  ? isoFromLocalAndTimezone(
                                      local,
                                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                                    )
                                  : undefined,
                                occurrences: undefined,
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
                                config: { ...cfg, endsAt: undefined },
                              } as FlowNode)
                            }
                            className="rounded border border-zinc-700 px-2 text-zinc-400 hover:text-red-300"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </Field>
                    <Field label="Occurrences — optional" error={fieldError("occurrences")}>
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
                            },
                          } as FlowNode)
                        }
                      />
                    </Field>
                  </>
                )}

                <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
                  Connect a Split action with fixed amounts to set employee salaries, or leave the
                  Split recipients empty in dev mode to configure salaries via the API. The payroll
                  contract pulls the total from the employer each period and distributes it.
                </div>
              </>
            );
          })()}
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
          <Field label="Price threshold" error={fieldError("threshold")}>
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
          <AssetSimpleSelect
            label="Asset In"
            asset={node.config.assetIn}
            onChange={(assetIn) =>
              onChange({ ...node, config: { ...node.config, assetIn } } as FlowNode)
            }
            expectedAsset={expectedAsset}
          />
          <AssetSimpleSelect
            label="Asset Out"
            asset={node.config.assetOut}
            onChange={(assetOut) =>
              onChange({ ...node, config: { ...node.config, assetOut } } as FlowNode)
            }
          />
          <Field label="Rate (basis points, 1–10000)" error={fieldError("rateBps")}>
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
            expectedAsset={expectedAsset}
          />
          <Field label="Vault address (G… or PENDING:)" error={fieldError("vault")}>
            <AddressInput
              value={node.config.vault}
              onChange={(vault) =>
                onChange({
                  ...node,
                  config: { ...node.config, vault },
                })
              }
              pending={isPendingAddress(node.config.vault)}
              error={!!fieldError("vault")}
              addressBook={addressBook}
              onAddressBookChange={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
            />
          </Field>
        </>
      )}

      {node.type === "email_notify" && (
        <>
          <EmailRecipientsField node={node} graph={graph} onChange={onChange} />
          <Field label="Subject" error={fieldError("subject")}>
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
          <Field label="Body" error={fieldError("body")}>
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

      {node.type === "cash_out" && (
        <>
          <div className="flex items-start gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
            <span className="material-symbols-outlined text-[14px]">payments</span>
            <span>
              Terminal cash-out. Funds leave the chain to the off-ramp treasury, then a bank payout
              is made via PDAX.{" "}
              {devMode
                ? "Bank details can be left blank and filled via the API after deploy."
                : "Bank details must be set before deploy."}
            </span>
          </div>
          <AssetField
            asset={node.config.asset}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Account name" error={fieldError("accountName")}>
            <input
              className="input"
              value={node.config.accountName}
              placeholder="Juan Dela Cruz"
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, accountName: e.target.value },
                } as FlowNode)
              }
            />
          </Field>
          <Field label="Account number" error={fieldError("accountNumber")}>
            <input
              className="input"
              value={node.config.accountNumber}
              placeholder="1234567890"
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, accountNumber: e.target.value },
                } as FlowNode)
              }
            />
          </Field>
          <Field label="Bank" error={fieldError("bankCode")}>
            <select
              className="input"
              value={node.config.bankCode}
              onChange={(e) =>
                onChange({
                  ...node,
                  config: { ...node.config, bankCode: e.target.value },
                } as FlowNode)
              }
            >
              <option value="">
                {devMode ? "— set via API after deploy —" : "— select bank —"}
              </option>
              <option value="BASECPH">BASECPH — BDO</option>
              <option value="BACTBPH">BACTBPH — BPI</option>
            </select>
          </Field>
          <ApiFillHint
            show={
              devMode &&
              !node.config.accountName &&
              !node.config.accountNumber &&
              !node.config.bankCode
            }
          >
            Leave the bank fields empty to fill them via the API after deploy. The contract deploys
            &ldquo;not configured&rdquo; and guards execution until they are set.
          </ApiFillHint>
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
              <option value="time_after">time after</option>
              <option value="time_before">time before</option>
            </select>
          </Field>
          {(node.config.kind === "amount_gt" || node.config.kind === "amount_lt") && (
            <Field label="Threshold" error={fieldError("amountStroops")}>
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
              <Field label="Oracle contract / account" error={fieldError("oracle")}>
                <input
                  className="input font-mono"
                  value={node.config.oracle}
                  onChange={(e) => {
                    const cfg = { ...node.config, oracle: e.target.value.trim() };
                    onChange({ ...node, config: cfg } as FlowNode);
                  }}
                />
              </Field>
              <Field label="Storage key" error={fieldError("key")}>
                <input
                  className="input"
                  value={node.config.key}
                  onChange={(e) => {
                    const cfg = { ...node.config, key: e.target.value };
                    onChange({ ...node, config: cfg } as FlowNode);
                  }}
                />
              </Field>
              <Field label="Threshold" error={fieldError("threshold")}>
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
                  <Field label="Date &amp; time" error={fieldError("at")}>
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
                  <Field label="Signers" error={fieldError("signers")}>
                    {cfg.signers.map((s, i) => (
                      <div key={i} className="mb-1 flex gap-1">
                        <AddressInput
                          value={s}
                          placeholder="G... or PENDING:label"
                          onChange={(address) => {
                            const next = [...cfg.signers];
                            next[i] = address;
                            onChange({ ...node, config: { ...cfg, signers: next } } as FlowNode);
                          }}
                          pending={isPendingAddress(s)}
                          error={!!fieldError(`signers.${i}`)}
                          addressBook={addressBook}
                          onAddressBookChange={refreshAddressBook}
                          addressBookLoading={addressBookLoading}
                          addressBookError={addressBookError}
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
                  <Field label="Threshold (min signers)" error={fieldError("threshold")}>
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

function SplitRecipientsEditor({
  node,
  trigger,
  sourceAmount,
  devMode,
  addressBook,
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  fieldErrors,
  onChange,
}: {
  node: Extract<FlowNode, { type: "split" }>;
  trigger: FlowNode | undefined;
  sourceAmount: string | undefined;
  devMode: boolean;
  addressBook: AddressEntry[];
  refreshAddressBook?: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  /** Per-field validation messages for this node, keyed by config path. */
  fieldErrors?: Map<string, string>;
  onChange: (n: FlowNode) => void;
}) {
  const onAddressBookChange = refreshAddressBook ?? (() => {});
  const listError = fieldErrors?.get("recipients") ?? null;
  const recipientError = (i: number, field: string): string | null =>
    fieldErrors?.get(`recipients.${i}.${field}`) ?? null;
  // In dev mode an empty recipients list means "fill via API"; the banner in
  // the parent ConfigPanel already covers it, so skip the editor entirely.
  if (devMode && node.config.recipients.length === 0) return null;

  const triggerType = trigger?.type ?? null;
  const isPayroll = triggerType === "payroll";
  const isStreamer = triggerType === "on_schedule";
  const fiatPayoutAvailable =
    triggerType === "payroll" ||
    (!devMode && triggerType !== null && FIAT_PAYOUT_TRIGGERS.has(triggerType));
  const mode = isPayroll
    ? "fixed"
    : isStreamer
      ? "percentage"
      : (node.config.recipients[0]?.mode ?? "percentage");
  const totalFixed = splitTotalFixedStroops(node.config.recipients);
  const minAmount = trigger?.type === "on_receive" ? trigger.config.minAmountStroops : undefined;

  // Cache the shares from the mode the user is leaving so that toggling
  // percentage → fixed → percentage restores the previously entered values
  // instead of silently zeroing them out. Keyed by recipient index.
  const modeCache = useRef<{
    bps: Map<number, number>;
    amountStroops: Map<number, string>;
  }>({ bps: new Map(), amountStroops: new Map() });

  // Each recipient card can be collapsed to a summary row. Default to all
  // expanded when there are only a few recipients; collapse all but the first
  // when the list gets long.
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(() => {
    if (node.config.recipients.length <= 3) {
      return new Set(node.config.recipients.map((_, i) => i));
    }
    return new Set([0]);
  });

  useEffect(() => {
    setExpandedRecipients(() => {
      const next = new Set<number>();
      if (node.config.recipients.length <= 3) {
        for (let i = 0; i < node.config.recipients.length; i++) next.add(i);
      }
      return next;
    });
    // Switching to a different split node invalidates the cached shares.
    modeCache.current = { bps: new Map(), amountStroops: new Map() };
  }, [node.id]);

  const toggleRecipient = (i: number) => {
    setExpandedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const deleteRecipient = (i: number) => {
    const nextRecipients = node.config.recipients.filter((_, j) => j !== i);
    onChange({
      ...node,
      config: { ...node.config, recipients: nextRecipients },
    } as FlowNode);
    setExpandedRecipients((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      }
      return next;
    });
  };

  const setMode = (newMode: "percentage" | "fixed") => {
    // Snapshot the current mode's values before the union switch discards them.
    node.config.recipients.forEach((r, i) => {
      if (r.mode === "percentage") modeCache.current.bps.set(i, r.bps);
      else modeCache.current.amountStroops.set(i, r.amountStroops);
    });
    const next = node.config.recipients.map((r, i) => {
      // Preserve mode-independent fields (payout/bank details) across the switch.
      const base = {
        address: r.address,
        label: r.label,
        payoutMode: r.payoutMode,
        accountName: r.accountName,
        accountNumber: r.accountNumber,
        bankCode: r.bankCode,
      };
      if (newMode === "percentage") {
        return { ...base, mode: "percentage" as const, bps: modeCache.current.bps.get(i) ?? 0 };
      }
      return {
        ...base,
        mode: "fixed" as const,
        amountStroops: modeCache.current.amountStroops.get(i) ?? "0",
      };
    });
    onChange({
      ...node,
      config: { ...node.config, recipients: next },
    } as FlowNode);
  };

  const updateRecipient = (i: number, r: SplitRecipient) => {
    const next = [...node.config.recipients];
    next[i] = r;
    onChange({
      ...node,
      config: { ...node.config, recipients: next },
    } as FlowNode);
  };

  return (
    <div className="space-y-3">
      {isPayroll ? (
        <div className="text-xs text-amber-400">
          Payroll distributions use fixed salary amounts only.
        </div>
      ) : isStreamer ? (
        <div className="text-xs text-amber-400">
          Scheduled streams distribute by percentage — use the Payroll trigger for fixed recurring
          amounts.
        </div>
      ) : (
        <Field label="Distribution mode">
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as "percentage" | "fixed")}
          >
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </Field>
      )}

      <div className={cn("text-xs", listError ? "text-error" : "text-zinc-400")}>
        {mode === "percentage"
          ? "Recipients (shares must sum to 100%)"
          : "Recipients (fixed amounts accumulate until the total is reached)"}
      </div>

      {listError && (
        <p role="alert" className="text-error -mt-2 text-[11px] leading-snug">
          {listError}
        </p>
      )}

      {mode === "percentage" && <AllocationBar recipients={node.config.recipients} />}

      {node.config.recipients.map((r, i) => {
        const isPending = isPendingAddress(r.address);
        const isPercentage = r.mode === "percentage";
        // Fiat recipients (any trigger) sink through an auto-generated cash-out
        // contract, so the wallet address and label are irrelevant — the bank
        // details below are the destination.
        const isFiatRecipient = r.payoutMode === "fiat";
        const isExpanded = expandedRecipients.has(i);
        const cardHasError = fieldErrors
          ? [...fieldErrors.keys()].some((k) => k.startsWith(`recipients.${i}.`))
          : false;
        const projected =
          isPercentage && sourceAmount
            ? stroopsToDisplay(
                ((BigInt(sourceAmount) * BigInt(r.bps)) / 10000n).toString(),
                node.config.asset,
              )
            : null;

        const summaryLabel = r.label
          ? r.label
          : isFiatRecipient
            ? r.accountName?.trim() || "Fiat off-ramp"
            : shortAddr(r.address);

        const summaryAmount = isPercentage
          ? `${bpsToPct(r.bps)}%`
          : r.amountStroops && r.amountStroops !== "0"
            ? stroopsToDisplay(r.amountStroops, node.config.asset)
            : "0";

        return (
          <div
            key={i}
            className={cn(
              "overflow-hidden rounded border bg-zinc-900/50",
              cardHasError ? "border-error/60" : "border-zinc-800",
            )}
          >
            <button
              type="button"
              onClick={() => toggleRecipient(i)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-zinc-800/50"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-zinc-500">
                  {r.payoutMode === "fiat" ? "account_balance" : "account_circle"}
                </span>
                <span className="truncate text-xs text-zinc-300">{summaryLabel}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-zinc-400">{summaryAmount}</span>
                <span className="material-symbols-outlined text-[16px] text-zinc-500">
                  {isExpanded ? "expand_less" : "expand_more"}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="space-y-2 border-t border-zinc-800 p-2 pt-1">
                {isFiatRecipient ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-400">Fiat off-ramp</span>
                      <button
                        onClick={() => deleteRecipient(i)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>
                    {isPercentage ? (
                      <Field label="Share" error={recipientError(i, "bps")}>
                        <div className="relative">
                          <input
                            className="input pr-5 text-right"
                            value={
                              r.bps === 0
                                ? ""
                                : (() => {
                                    const pct = bpsToPct(r.bps);
                                    return pct === Math.floor(pct) ? `${pct}` : `${pct.toFixed(1)}`;
                                  })()
                            }
                            placeholder="0"
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              updateRecipient(i, {
                                ...r,
                                bps: isNaN(v) ? 0 : Math.min(10000, Math.max(0, pctToBps(v))),
                              } as SplitRecipient);
                            }}
                          />
                          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[11px] text-zinc-500">
                            %
                          </span>
                        </div>
                      </Field>
                    ) : (
                      <Field label="Amount" error={recipientError(i, "amountStroops")}>
                        <input
                          className="input text-right"
                          value={
                            (r as Extract<SplitRecipient, { mode: "fixed" }>).amountStroops
                              ? formatStroops(
                                  (r as Extract<SplitRecipient, { mode: "fixed" }>).amountStroops,
                                )
                              : ""
                          }
                          placeholder="0"
                          onChange={(e) => {
                            const stroops = tokenAmountToStroops(e.target.value);
                            updateRecipient(i, {
                              ...r,
                              amountStroops: stroops || "0",
                            } as SplitRecipient);
                          }}
                        />
                      </Field>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Row 1: wallet address + delete */}
                    <div className="grid grid-cols-[1fr_28px] items-start gap-1">
                      <div className="grid gap-0.5">
                        <AddressInput
                          value={r.address}
                          placeholder="G... or PENDING:label"
                          onChange={(address) =>
                            updateRecipient(i, {
                              ...r,
                              address,
                            } as SplitRecipient)
                          }
                          onSelectEntry={(entry) =>
                            updateRecipient(i, {
                              ...r,
                              address: entry.address,
                              label: entry.label || r.label,
                            } as SplitRecipient)
                          }
                          pending={isPendingAddress(r.address)}
                          error={!!recipientError(i, "address")}
                          addressBook={addressBook}
                          onAddressBookChange={onAddressBookChange}
                          addressBookLoading={addressBookLoading}
                          addressBookError={addressBookError}
                        />
                        {recipientError(i, "address") && (
                          <span className="text-error text-[10px] leading-snug">
                            {recipientError(i, "address")}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => deleteRecipient(i)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>

                    {/* Row 2: share / amount */}
                    <div className="mt-1 grid gap-0.5">
                      <span className="text-[10px] text-zinc-500">
                        {isPercentage ? "Share" : `Amount (${assetLabel(node.config.asset)})`}
                      </span>
                      {isPercentage ? (
                        <div className="relative">
                          <input
                            className={cn(
                              "input pr-5 text-right",
                              recipientError(i, "bps") && "!border-error/70",
                            )}
                            value={
                              r.bps === 0
                                ? ""
                                : (() => {
                                    const pct = bpsToPct(r.bps);
                                    return pct === Math.floor(pct) ? `${pct}` : `${pct.toFixed(1)}`;
                                  })()
                            }
                            placeholder="0"
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              updateRecipient(i, {
                                ...r,
                                bps: isNaN(v) ? 0 : Math.min(10000, Math.max(0, pctToBps(v))),
                              } as SplitRecipient);
                            }}
                          />
                          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[11px] text-zinc-500">
                            %
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <input
                              className={cn(
                                "input pr-5 text-right",
                                recipientError(i, "amountStroops") && "!border-error/70",
                              )}
                              value={r.amountStroops ? formatStroops(r.amountStroops) : ""}
                              placeholder="0"
                              onChange={(e) => {
                                const stroops = tokenAmountToStroops(e.target.value);
                                updateRecipient(i, {
                                  ...r,
                                  amountStroops: stroops || "0",
                                } as SplitRecipient);
                              }}
                            />
                          </div>
                          {recipientError(i, "amountStroops") && (
                            <span className="text-error text-[10px] leading-snug">
                              {recipientError(i, "amountStroops")}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-1">
                      <input
                        className="input text-xs"
                        value={r.label ?? ""}
                        placeholder="Label (e.g. Alice)"
                        onChange={(e) =>
                          updateRecipient(i, {
                            ...r,
                            label: e.target.value || undefined,
                          } as SplitRecipient)
                        }
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
                        {!isPercentage && r.amountStroops && r.amountStroops !== "0" && (
                          <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            {stroopsToDisplay(r.amountStroops, node.config.asset)}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {fiatPayoutAvailable && (
                  <div className="space-y-2 pt-1">
                    <Field label="Payout mode">
                      <select
                        className="input text-xs"
                        value={r.payoutMode ?? "crypto"}
                        onChange={(e) => {
                          const mode = e.target.value as "crypto" | "fiat";
                          const isFiatNext = mode === "fiat";
                          const base = {
                            ...r,
                            payoutMode: mode,
                            // Fiat recipients get an auto-generated cash-out
                            // contract at deploy time, so the wallet address
                            // and label are hidden and replaced with a
                            // sentinel. Switching back to crypto restores a
                            // resolvable pending placeholder.
                            address: isFiatNext
                              ? "PENDING:fiat"
                              : r.address === "PENDING:fiat"
                                ? "PENDING:unnamed"
                                : r.address,
                            label: isFiatNext ? undefined : r.label,
                          };
                          updateRecipient(
                            i,
                            mode === "fiat" && !devMode
                              ? {
                                  ...base,
                                  accountName: r.accountName ?? "",
                                  accountNumber: r.accountNumber ?? "",
                                  bankCode: r.bankCode ?? "",
                                }
                              : base,
                          );
                        }}
                      >
                        <option value="crypto">Crypto (wallet)</option>
                        <option value="fiat">Fiat (bank transfer)</option>
                      </select>
                    </Field>

                    {r.payoutMode === "fiat" && !devMode && (
                      <>
                        <Field label="Account name" error={recipientError(i, "accountName")}>
                          <input
                            className="input text-xs"
                            value={r.accountName ?? ""}
                            placeholder="Juan Dela Cruz"
                            onChange={(e) =>
                              updateRecipient(i, {
                                ...r,
                                accountName: e.target.value,
                              } as SplitRecipient)
                            }
                          />
                        </Field>
                        <Field label="Account number" error={recipientError(i, "accountNumber")}>
                          <input
                            className="input text-xs"
                            value={r.accountNumber ?? ""}
                            placeholder="1234567890"
                            onChange={(e) =>
                              updateRecipient(i, {
                                ...r,
                                accountNumber: e.target.value,
                              } as SplitRecipient)
                            }
                          />
                        </Field>
                        <Field label="Bank" error={recipientError(i, "bankCode")}>
                          <select
                            className="input text-xs"
                            value={r.bankCode ?? ""}
                            onChange={(e) =>
                              updateRecipient(i, {
                                ...r,
                                bankCode: e.target.value,
                              } as SplitRecipient)
                            }
                          >
                            <option value="">— select bank —</option>
                            <option value="BASECPH">BASECPH — BDO</option>
                            <option value="BACTBPH">BACTBPH — BPI</option>
                          </select>
                        </Field>
                      </>
                    )}

                    {r.payoutMode === "fiat" && devMode && (
                      <div className="rounded border border-amber-800/40 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-300">
                        Bank details configured via API after deploy.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {mode === "percentage" && remainingPct(node.config.recipients) > 0 && (
        <div className="text-xs text-amber-400">
          Remaining: {remainingPct(node.config.recipients).toFixed(1)}% unallocated
        </div>
      )}

      {mode === "percentage" &&
        node.config.recipients.reduce((s, r2) => s + (r2.mode === "percentage" ? r2.bps : 0), 0) >
          TOTAL_BPS && (
          <div className="text-xs text-red-400">
            Total exceeds 100% by{" "}
            {(
              (node.config.recipients.reduce(
                (s, r2) => s + (r2.mode === "percentage" ? r2.bps : 0),
                0,
              ) -
                TOTAL_BPS) /
              100
            ).toFixed(1)}
            %
          </div>
        )}

      {mode === "fixed" && totalFixed && (
        <div className="text-xs text-zinc-400">
          Total fixed amount:{" "}
          <span className="font-mono text-zinc-300">
            {stroopsToDisplay(totalFixed, node.config.asset)}
          </span>
        </div>
      )}

      {mode === "fixed" && minAmount && totalFixed && BigInt(totalFixed) > BigInt(minAmount) && (
        <div className="text-xs text-amber-400">
          Total fixed amount is greater than the trigger minimum. Deposits will accumulate until the
          total is reached.
        </div>
      )}

      <button
        className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
        onClick={() => {
          const nextRecipients = [
            ...node.config.recipients,
            isPayroll || mode === "fixed"
              ? {
                  address: "PENDING:unnamed",
                  mode: "fixed" as const,
                  amountStroops: "0",
                }
              : {
                  address: "PENDING:unnamed",
                  mode: "percentage" as const,
                  bps: 100,
                },
          ];
          onChange({
            ...node,
            config: { ...node.config, recipients: nextRecipients },
          } as FlowNode);
          setExpandedRecipients((prev) => {
            const next = new Set(prev);
            next.add(nextRecipients.length - 1);
            return next;
          });
        }}
      >
        + Add recipient
      </button>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className={cn("text-xs", error ? "text-error" : "text-zinc-400")}>{label}</span>
      <div className={cn("grid gap-1", error && "[&_.input]:!border-error/70")}>{children}</div>
      {error && <span className="text-error text-[11px] leading-snug">{error}</span>}
    </label>
  );
}

/**
 * A field with an explicit "Fill via API" affordance, shown only in dev mode.
 * When the toggle is on, the input is replaced by a banner and the underlying
 * value is the blank sentinel; the developer fills it through the API after
 * deploy. Outside dev mode it renders as a plain `Field`.
 */
function ApiFillField({
  label,
  devMode,
  active,
  onActivate,
  onDeactivate,
  hint = "Set via the API after deploy",
  error,
  children,
}: {
  label: string;
  devMode: boolean;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  if (!devMode) {
    return (
      <Field label={label} error={error}>
        {children}
      </Field>
    );
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className={cn("text-xs", error && !active ? "text-error" : "text-zinc-400")}>
          {label}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-amber-400">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => (e.target.checked ? onActivate() : onDeactivate())}
          />
          Fill via API
        </label>
      </div>
      {active ? (
        <div className="flex items-center gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 font-mono text-[12px] text-amber-300">
          <span className="material-symbols-outlined text-[14px]">tune</span>
          {hint}
        </div>
      ) : (
        children
      )}
      {error && !active && <span className="text-error text-[11px] leading-snug">{error}</span>}
    </div>
  );
}

/** Inline amber hint shown under an already-emptyable field in dev mode. */
function ApiFillHint({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return <div className="mt-0.5 text-[11px] text-amber-400/80">{children}</div>;
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
    if (parent?.type === "split" && parent.config.recipients[0]?.mode === "fixed") {
      variables.push("balance", "needed", "remaining", "shortfall");
    }
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
              type="email"
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

function AssetOptionInfoIcon({ expectedAsset }: { expectedAsset: Asset }) {
  return (
    <span
      className="material-symbols-outlined cursor-help text-[14px] text-zinc-500"
      title={`Only ${assetLabel(expectedAsset)} can be picked here — that's the asset flowing into this step. Add or change a swap node upstream to use a different asset.`}
    >
      info
    </span>
  );
}

type SimpleAsset =
  | { kind: "native" }
  | { kind: "known"; symbol: "USDC" }
  | { kind: "custom"; code: string; issuer: string };

function AssetFieldLabel({
  label,
  expectedAsset,
}: {
  label: React.ReactNode;
  expectedAsset?: Asset | null;
}) {
  if (!expectedAsset) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <AssetOptionInfoIcon expectedAsset={expectedAsset} />
    </span>
  );
}

/**
 * The dropdown below only offers native/USDC. When the upstream trigger
 * carries a custom asset, neither option is valid — rather than disabling
 * both and leaving the field dead, show the required asset read-only and
 * force the node's config to match it, since there is no other value the
 * user could legitimately pick.
 */
function AssetSelectOrReadout({
  label,
  asset,
  onChange,
  expectedAsset,
}: {
  label: React.ReactNode;
  asset: SimpleAsset;
  onChange: (a: SimpleAsset) => void;
  expectedAsset?: Asset | null;
}) {
  useEffect(() => {
    if (expectedAsset?.kind === "custom" && !assetsEqual(expectedAsset, asset)) {
      onChange(expectedAsset);
    }
  }, [expectedAsset, asset, onChange]);

  if (expectedAsset?.kind === "custom") {
    return (
      <Field label={<AssetFieldLabel label={label} expectedAsset={expectedAsset} />}>
        <div className="input flex items-center text-zinc-400">{assetLabel(expectedAsset)}</div>
      </Field>
    );
  }

  const nativeDisabled = !!expectedAsset && !assetsEqual(expectedAsset, { kind: "native" });
  const usdcDisabled =
    !!expectedAsset && !assetsEqual(expectedAsset, { kind: "known", symbol: "USDC" });
  return (
    <Field label={<AssetFieldLabel label={label} expectedAsset={expectedAsset} />}>
      <select
        className="input"
        value={asset.kind === "known" ? `known:${asset.symbol}` : asset.kind}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "native") onChange({ kind: "native" });
          else if (v === "known:USDC") onChange({ kind: "known", symbol: "USDC" });
        }}
      >
        <option value="known:USDC" disabled={usdcDisabled}>
          USDC
        </option>
        <option value="native" disabled={nativeDisabled}>
          XLM (native)
        </option>
      </select>
    </Field>
  );
}

function AssetField({
  asset,
  onChange,
  expectedAsset,
}: {
  asset: SimpleAsset;
  onChange: (a: SimpleAsset) => void;
  expectedAsset?: Asset | null;
}) {
  return (
    <AssetSelectOrReadout
      label="Asset"
      asset={asset}
      onChange={onChange}
      expectedAsset={expectedAsset}
    />
  );
}

function AssetSimpleSelect({
  label,
  asset,
  onChange,
  expectedAsset,
}: {
  label: string;
  asset: SimpleAsset;
  onChange: (a: SimpleAsset) => void;
  expectedAsset?: Asset | null;
}) {
  return (
    <AssetSelectOrReadout
      label={label}
      asset={asset}
      onChange={onChange}
      expectedAsset={expectedAsset}
    />
  );
}

function remainingPct(recipients: SplitRecipient[]): number {
  const used = recipients.reduce((s, r) => (r.mode === "percentage" ? s + r.bps : s), 0);
  return Math.max(0, (TOTAL_BPS - used) / 100);
}

function AllocationBar({ recipients }: { recipients: SplitRecipient[] }) {
  const percentageRecipients = recipients.filter(
    (r): r is Extract<SplitRecipient, { mode: "percentage" }> => r.mode === "percentage",
  );
  const total = percentageRecipients.reduce((s, r) => s + r.bps, 0);
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
      {percentageRecipients.map((r, i) => {
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
