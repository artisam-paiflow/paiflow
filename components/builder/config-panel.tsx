"use client";
import { useEffect, useMemo } from "react";
import type { FlowNode, FlowGraph } from "@/lib/flows/schema";
import {
  isPendingAddress,
  sourceAmountStroops,
  isTrigger,
  TOTAL_BPS,
  assetLabel,
  stroopsToDisplay,
  splitTotalFixedStroops,
} from "@/lib/flows/schema";
import { cn, formatStroops } from "@/lib/utils";
import { NODE_TYPE_LABELS } from "@/lib/flows/node-labels";
import type { AddressEntry } from "@/lib/address-book.types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import { computeAssetFlow, type ValidationIssue } from "@/lib/flows/validate";
import { fieldErrorUnder, nodeIssues } from "@/lib/flows/issue-paths";
import type { FeatureFlags } from "@/lib/feature-flags";
import { AssetField, Field } from "./panels/asset-fields";
import { IntervalField } from "./panels/interval-field";
import {
  fiatPayoutAvailable as fiatAvailable,
  showPayoutModeSelect,
} from "./panels/payout-mode.utils";
import SwapPanel from "./panels/swap-panel";
import { SplitRecipientsEditor } from "./panels/split-recipients-editor";
import { AmountInput } from "./inputs/amount-input";
import { PercentageInput } from "./inputs/percentage-input";
import { Field as SharedField } from "./inputs/field";
import { inputClass } from "./inputs/styles";
import { NodeAssetField } from "./panels/node-asset-field";
import { RecipientEmailField } from "./notification-settings";
import AddressInput from "./address-input";
import { AddressPicker } from "./inputs/address-picker";
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
  /** The graph's validation issues, computed once by the builder and shared with this panel. */
  errors: ValidationIssue[];
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
  addressBook?: AddressEntry[];
  refreshAddressBook?: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  className?: string;
  /**
   * The network this environment is pinned to, resolved from STELLAR_NETWORK on
   * the server and passed down as a prop (the same route DeployReview takes).
   * Named on the swap panel's router field.
   */
  network: StellarNetwork;
  /** The Soroswap router this environment resolves to; `undefined` when unset. */
  routerContractId?: string;
  /**
   * Hide the internal node-type label + Delete header row. Set when the docked
   * wrapper renders its own fixed header with the title and Delete control,
   * so the title isn't duplicated.
   */
  hideHeader?: boolean;
  /** Surface switches from the server (#722). */
  features: FeatureFlags;
  sandbox?: boolean;
};
export default function ConfigPanel({
  node,
  graph,
  errors,
  onChange,
  onDelete,
  addressBook = [],
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  className,
  network,
  routerContractId,
  hideHeader = false,
  features,
  sandbox = false,
}: Props) {
  const expectedAsset = useMemo(
    () => (node ? (computeAssetFlow(graph).get(node.id) ?? null) : null),
    [graph, node],
  );
  const nodeErrors = useMemo(
    () =>
      node
        ? nodeIssues(
            errors,
            node.id,
            graph.nodes.findIndex((n) => n.id === node.id),
          )
        : { field: new Map<string, string>(), general: [] },
    [errors, graph.nodes, node],
  );
  const fieldError = (name: string): string | null => nodeErrors.field.get(name) ?? null;
  // Every AssetField edits `config.asset`; a Zod issue lands under it
  // (`asset.code`, `asset.issuer`), validateFlow's mismatch on it (#407).
  const assetError = fieldErrorUnder(nodeErrors.field, "asset");
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
  const fiatPayoutAvailable = fiatAvailable(features.offramp, triggerType);
  const payPayoutSelect =
    node.type === "pay" &&
    showPayoutModeSelect(fiatPayoutAvailable, features.offramp, node.config.payoutMode);
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
  // Streamer (on_schedule) vests a fixed amount per interval — "send full
  // amount" and percentage mode have no referent because the funded total is
  // derived from the configured amount (unlike on_receive, where the incoming
  // payment is unknown at design time). If a user switches an existing pay
  // node to an on_schedule trigger, reset it to fixed mode.
  useEffect(() => {
    if (triggerType !== "on_schedule" || node.type !== "pay") return;
    if (!node.config.fullAmount && node.config.mode !== "percentage") return;
    onChange({
      ...node,
      config: {
        ...node.config,
        fullAmount: false,
        mode: "fixed" as const,
        percentage: undefined,
      },
    } as FlowNode);
  }, [triggerType, node, onChange]);
  return (
    <aside
      data-testid="config-panel"
      className={cn(
        // The docked container owns scrolling; fields keep their natural height.
        "space-y-4 border-l border-zinc-800 bg-zinc-950 p-4 text-sm",
        className,
      )}
    >
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div className="text-on-surface text-xs tracking-wider uppercase">
            {NODE_TYPE_LABELS[node.type]}
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
          <NodeAssetField
            asset={node.config.asset}
            error={assetError}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <AmountInput
            label={`Minimum amount (${assetLabel(node.config.asset)}), optional`}
            error={fieldError("minAmountStroops")}
            value={node.config.minAmountStroops}
            placeholder="Any amount"
            onChange={(stroops) => {
              onChange({
                ...node,
                config: { ...node.config, minAmountStroops: stroops || undefined },
              });
            }}
            commit="draft"
            echo={false}
            asset={node.config.asset}
            hint={
              <>
                {node.config.minAmountStroops && (
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    ≥ {stroopsToDisplay(node.config.minAmountStroops, node.config.asset)}
                  </div>
                )}
              </>
            }
          />
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
              <IntervalField
                shared
                amount={amount}
                unit={unit}
                amountError={fieldError("intervalAmount")}
                unitError={fieldError("intervalUnit")}
                onAmountChange={(intervalAmount) =>
                  onChange({
                    ...node,
                    config: { ...cfg, intervalAmount, intervalUnit: unit, timeZone: tz },
                  } as FlowNode)
                }
                onUnitChange={(intervalUnit) =>
                  onChange({
                    ...node,
                    config: { ...cfg, intervalAmount: amount, intervalUnit, timeZone: tz },
                  } as FlowNode)
                }
              />
              <SharedField label="Timezone">
                {(control) => (
                  <select
                    {...control}
                    className={inputClass}
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
                )}
              </SharedField>
              <SharedField label="Starts at" error={fieldError("startsAt")}>
                {(control) => (
                  <input
                    {...control}
                    className={inputClass}
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
                )}
              </SharedField>
              <SharedField label="Ends at — optional" error={fieldError("endsAt")}>
                {(control) => (
                  <>
                    <div className="flex gap-1">
                      <input
                        {...control}
                        className={inputClass}
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
                  </>
                )}
              </SharedField>
              <SharedField label="Occurrences — optional" error={fieldError("occurrences")}>
                {(control) => (
                  <input
                    {...control}
                    className={inputClass}
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
                )}
              </SharedField>
              <SharedField group label="Allow pause / resume">
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
              </SharedField>
              <SharedField group label="Allow retrieve unvested">
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
              </SharedField>
            </>
          );
        })()}

      {node.type === "pay" && (
        <>
          {!sandbox && (
            <RecipientEmailField
              shared={triggerType !== "payroll" && node.config.payoutMode !== "fiat"}
              value={node.config.email}
              onChange={(email) => onChange({ ...node, config: { ...node.config, email } })}
            />
          )}
          <NodeAssetField
            asset={node.config.asset}
            error={assetError}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
            expectedAsset={expectedAsset}
          />

          {!(fiatPayoutAvailable && node.config.payoutMode === "fiat") && (
            <>
              {
                <AddressPicker
                  label="Recipient (G… or PENDING:)"
                  error={fieldError("recipient")}
                  value={node.config.recipient}
                  onChange={(recipient) =>
                    onChange({
                      ...node,
                      config: { ...node.config, recipient },
                    })
                  }
                  pending={isPendingAddress(node.config.recipient)}
                  addressBook={addressBook}
                  onAddressBookChange={refreshAddressBook}
                  addressBookLoading={addressBookLoading}
                  addressBookError={addressBookError}
                />
              }
            </>
          )}

          {payPayoutSelect && (
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
                        ...(mode === "fiat"
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
                  <option value="fiat" disabled={!fiatPayoutAvailable}>
                    Fiat (bank transfer)
                  </option>
                </select>
              </Field>

              {fiatPayoutAvailable && node.config.payoutMode === "fiat" && (
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

              {false}
            </div>
          )}

          {false}

          {triggerType === "on_schedule" ? (
            // Scheduled streams vest a fixed amount per interval — full-amount
            // and percentage modes are not offered here.
            <AmountInput
              label={`Amount per interval (${assetLabel(node.config.asset)})`}
              error={fieldError("amountStroops")}
              value={node.config.amountStroops}
              onChange={(stroops) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    amountStroops: stroops,
                  },
                } as FlowNode)
              }
              commit="draft"
              echo={false}
              asset={node.config.asset}
              hint={
                <>
                  {node.config.amountStroops && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      = {stroopsToDisplay(node.config.amountStroops, node.config.asset)} per
                      interval
                    </div>
                  )}
                </>
              }
            />
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
                  <SharedField label="Mode">
                    {(control) => (
                      <select
                        {...control}
                        className={inputClass}
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
                    )}
                  </SharedField>

                  {node.config.mode === "fixed" && (
                    <AmountInput
                      label={`Amount (${assetLabel(node.config.asset)})`}
                      error={fieldError("amountStroops")}
                      value={node.config.amountStroops}
                      onChange={(stroops) =>
                        onChange({
                          ...node,
                          config: {
                            ...node.config,
                            amountStroops: stroops,
                          },
                        })
                      }
                      commit="draft"
                      echo={false}
                      asset={node.config.asset}
                      hint={
                        <>
                          {node.config.amountStroops && (
                            <div className="mt-0.5 text-[11px] text-zinc-500">
                              = {stroopsToDisplay(node.config.amountStroops, node.config.asset)}
                            </div>
                          )}
                        </>
                      }
                    />
                  )}

                  {node.config.mode === "percentage" && (
                    <PercentageInput
                      label="Percentage"
                      error={fieldError("percentage")}
                      value={node.config.percentage}
                      onChange={(percentage) =>
                        onChange({ ...node, config: { ...node.config, percentage } })
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {node.type === "split" && (
        <>
          <NodeAssetField
            asset={node.config.asset}
            error={assetError}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
            expectedAsset={expectedAsset}
          />

          {false}

          {<></>}

          {triggerType === "on_schedule" &&
            (node.config.recipients.length > 0 &&
            node.config.recipients.every((r) => r.mode === "fixed") ? (
              // Fixed mode: the per-interval base is the sum of the recipient
              // amounts (streamerAmountPerInterval in to-params.ts), so the
              // separate field is neither shown nor required.
              <div className="text-[11px] text-zinc-500">
                Amount per interval:{" "}
                {stroopsToDisplay(
                  splitTotalFixedStroops(node.config.recipients) ?? "0",
                  node.config.asset,
                )}{" "}
                — the sum of the recipient amounts below
              </div>
            ) : (
              <AmountInput
                label={
                  <>
                    Amount per interval ({assetLabel(node.config.asset)}){" "}
                    <span className="text-error">*</span>
                  </>
                }
                error={fieldError("amountPerIntervalStroops")}
                value={node.config.amountPerIntervalStroops}
                placeholder="Amount released each interval"
                onChange={(stroops) => {
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      amountPerIntervalStroops: stroops || undefined,
                    },
                  });
                }}
                commit="draft"
                echo={false}
                asset={node.config.asset}
                hint={
                  <>
                    {node.config.amountPerIntervalStroops && (
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        ={" "}
                        {stroopsToDisplay(node.config.amountPerIntervalStroops, node.config.asset)}{" "}
                        per interval
                      </div>
                    )}
                  </>
                }
              />
            ))}

          {node.type === "split" && (
            <SplitRecipientsEditor
              node={
                node as Extract<
                  FlowNode,
                  {
                    type: "split";
                  }
                >
              }
              trigger={trigger}
              sourceAmount={sourceAmount}
              addressBook={addressBook}
              refreshAddressBook={refreshAddressBook}
              addressBookLoading={addressBookLoading}
              addressBookError={addressBookError}
              fieldErrors={nodeErrors.field}
              onChange={onChange}
              offrampEnabled={features.offramp}
              sandbox={sandbox}
            />
          )}
        </>
      )}

      {node.type === "webhook" && (
        <>
          <AssetField
            asset={node.config.asset}
            error={assetError}
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
          <NodeAssetField
            asset={node.config.asset}
            error={assetError}
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
          <NodeAssetField
            asset={node.config.asset}
            error={assetError}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <>
            {
              <AddressPicker
                label="Subscriber address (G… or PENDING:)"
                error={fieldError("subscriber")}
                value={node.config.subscriber}
                onChange={(subscriber) =>
                  onChange({
                    ...node,
                    config: { ...node.config, subscriber },
                  })
                }
                pending={isPendingAddress(node.config.subscriber)}
                addressBook={addressBook}
                onAddressBookChange={refreshAddressBook}
                addressBookLoading={addressBookLoading}
                addressBookError={addressBookError}
              />
            }
          </>
          {(() => {
            // When the subscription feeds a split whose recipients are all
            // fixed amounts, the per-period pull is DERIVED from their sum
            // (flowToPipeline does the same) — the manual field would only
            // contradict the recipient amounts, so show the derived value
            // read-only instead. Mirrors the streamer fixed-split rule.
            const downstreamId = graph.edges.find((e) => e.source === node.id)?.target;
            const downstream = graph.nodes.find((n) => n.id === downstreamId);
            const fixedTotal =
              downstream?.type === "split" &&
              downstream.config.recipients.length > 0 &&
              downstream.config.recipients.every((r) => r.mode === "fixed")
                ? splitTotalFixedStroops(downstream.config.recipients)
                : null;
            if (fixedTotal && fixedTotal !== "0") {
              return (
                <SharedField group label={`Amount per period (${assetLabel(node.config.asset)})`}>
                  <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
                    Derived from the split recipients: {formatStroops(fixedTotal)}{" "}
                    {assetLabel(node.config.asset)} per period (sum of the fixed amounts).
                  </div>
                </SharedField>
              );
            }
            return (
              <AmountInput
                label={`Amount per period (${assetLabel(node.config.asset)})`}
                error={fieldError("amountPerPeriodStroops")}
                value={node.config.amountPerPeriodStroops}
                onChange={(stroops) =>
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      amountPerPeriodStroops: stroops,
                    },
                  })
                }
                commit="draft"
                echo={false}
                asset={node.config.asset}
                hint={<>{null}</>}
              />
            );
          })()}
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
                <IntervalField
                  shared
                  amount={amount}
                  unit={unit}
                  amountError={fieldError("intervalAmount")}
                  unitError={fieldError("intervalUnit")}
                  onAmountChange={(intervalAmount) =>
                    onChange({
                      ...node,
                      config: { ...cfg, intervalAmount, intervalUnit: unit },
                    } as FlowNode)
                  }
                  onUnitChange={(intervalUnit) =>
                    onChange({
                      ...node,
                      config: { ...cfg, intervalAmount: amount, intervalUnit },
                    } as FlowNode)
                  }
                />
                <SharedField label="Ends at — optional" error={fieldError("endsAt")}>
                  {(control) => (
                    <>
                      <div className="flex gap-1">
                        <input
                          {...control}
                          className={inputClass}
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
                    </>
                  )}
                </SharedField>
                <SharedField label="Occurrences — optional" error={fieldError("occurrences")}>
                  {(control) => (
                    <input
                      {...control}
                      className={inputClass}
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
                  )}
                </SharedField>
              </>
            );
          })()}
        </>
      )}

      {node.type === "payroll" && (
        <>
          <AssetField
            asset={node.config.asset}
            error={assetError}
            onChange={(asset) =>
              onChange({ ...node, config: { ...node.config, asset } } as FlowNode)
            }
          />
          <Field label="Employer address (G… or PENDING:)" error={fieldError("employer")}>
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
          </Field>
          {(() => {
            const cfg = node.config as {
              intervalAmount?: number;
              intervalUnit?: "minute" | "hour" | "day" | "week" | "month";
              endsAt?: string;
              occurrences?: number;
            };
            const amount = cfg.intervalAmount ?? 1;
            const unit = cfg.intervalUnit ?? "week";
            return (
              <>
                {false}

                {
                  <>
                    <IntervalField
                      amount={amount}
                      unit={unit}
                      amountError={fieldError("intervalAmount")}
                      unitError={fieldError("intervalUnit")}
                      onAmountChange={(intervalAmount) =>
                        onChange({
                          ...node,
                          config: { ...cfg, intervalAmount, intervalUnit: unit },
                        } as FlowNode)
                      }
                      onUnitChange={(intervalUnit) =>
                        onChange({
                          ...node,
                          config: { ...cfg, intervalAmount: amount, intervalUnit },
                        } as FlowNode)
                      }
                    />
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
                }

                <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
                  Connect a Split action with fixed amounts to set employee salaries. The payroll
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
            error={assetError}
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
        <SwapPanel
          // Keyed so the preview amount and every draft reset with the selection.
          key={node.id}
          node={node}
          onChange={onChange}
          fieldError={fieldError}
          expectedAsset={expectedAsset}
          network={network}
          routerContractId={routerContractId}
        />
      )}

      {node.type === "yield" && (
        <>
          <AssetField
            asset={node.config.asset}
            error={assetError}
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

      {(node.type === "hold" || node.type === "return_to_owner") && (
        <p className="text-on-surface-variant text-body-sm">
          {node.type === "hold"
            ? "Connect Hold to the before side of a time condition. Funds stay strictly locked until the deadline, then follow the after destination. Early release is impossible."
            : "Returns 100% of the incoming amount to the wallet that signs deployment. The recipient is resolved during preparation and stays immutable. Connect directly after an amount, time, or multisig condition."}
        </p>
      )}

      {node.type === "cash_out" && (
        <>
          <div className="flex items-start gap-1.5 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
            <span className="material-symbols-outlined text-[14px]">payments</span>
            <span>
              Terminal cash-out. Funds leave the chain to the off-ramp treasury, then a bank payout
              is made via PDAX. {"Bank details must be set before deploy."}
            </span>
          </div>
          <AssetField
            asset={node.config.asset}
            error={assetError}
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
              <option value="">{"— select bank —"}</option>
              <option value="BASECPH">BASECPH — BDO</option>
              <option value="BACTBPH">BACTBPH — BPI</option>
            </select>
          </Field>
          {null}
        </>
      )}

      {node.type === "condition" && (
        <>
          <SharedField label="Condition kind">
            {(control) => (
              <select
                {...control}
                className={inputClass}
                value={node.config.kind}
                onChange={(e) => {
                  const k = e.target.value;
                  if (k === "amount_gt" || k === "amount_lt") {
                    onChange({
                      ...node,
                      config: { kind: k, amountStroops: "10000000" },
                    } as FlowNode);
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
                <option value="amount_gt">amount &gt;</option>
                <option value="amount_lt">amount &lt;</option>
                <option value="time_after">time after</option>
                <option value="time_before">time before</option>
              </select>
            )}
          </SharedField>
          {(node.config.kind === "amount_gt" || node.config.kind === "amount_lt") && (
            <AmountInput
              label="Threshold"
              error={fieldError("amountStroops")}
              value={node.config.amountStroops}
              onChange={(stroops) => {
                const next =
                  node.config.kind === "amount_gt"
                    ? { kind: "amount_gt" as const, amountStroops: stroops }
                    : { kind: "amount_lt" as const, amountStroops: stroops };
                onChange({ ...node, config: next } as FlowNode);
              }}
              commit="draft"
              echo={false}
              asset={trigger?.type === "on_receive" ? trigger.config.asset : undefined}
              hint={
                <>
                  {trigger?.type === "on_receive" && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      = {stroopsToDisplay(node.config.amountStroops, trigger.config.asset)}
                    </div>
                  )}
                </>
              }
            />
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
                  <SharedField label="Date &amp; time" error={fieldError("at")}>
                    {(control) => (
                      <input
                        {...control}
                        className={inputClass}
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
                    )}
                  </SharedField>
                  <SharedField label="Timezone">
                    {(control) => (
                      <select
                        {...control}
                        className={inputClass}
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
                    )}
                  </SharedField>
                  <p className="text-on-surface-variant text-[11px] leading-snug">
                    The funds are held until released.{" "}
                    {cfg.kind === "time_before"
                      ? "True is released before this time; False at or after it."
                      : "True is released at or after this time; False before it."}{" "}
                    Connect a step to both outputs. The before side can be released early by your
                    wallet; the automatic release runs at or after this time.
                  </p>
                </>
              );
            })()}
          {node.config.kind === "multisig" &&
            (() => {
              const cfg = node.config as Extract<
                typeof node.config,
                {
                  kind: "multisig";
                }
              >;
              return (
                <>
                  <Field label="Signers" error={fieldError("signers")}>
                    {cfg.signers.map((s, i) => (
                      <div key={i} className="mb-1 flex gap-1">
                        <div className="grid min-w-0 flex-1 gap-0.5">
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
                          {fieldError(`signers.${i}`) && (
                            <span className="text-error text-[10px] leading-snug">
                              {fieldError(`signers.${i}`)}
                            </span>
                          )}
                        </div>
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
        :global([data-testid="config-panel"] .input) {
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
