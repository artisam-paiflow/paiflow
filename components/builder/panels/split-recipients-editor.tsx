"use client";
import { useEffect, useRef, useState } from "react";
import type { FlowNode, SplitRecipient } from "@/lib/flows/schema";
import {
  isPendingAddress,
  bpsToPct,
  TOTAL_BPS,
  stroopsToDisplay,
  splitTotalFixedStroops,
} from "@/lib/flows/schema";
import { cn, shortAddr } from "@/lib/utils";
import type { AddressEntry } from "@/lib/address-book.types";
import { RecipientEmailField } from "../notification-settings";
import AddressInput from "../address-input";
import { AmountInput } from "../inputs/amount-input";
import { ShareInput } from "../inputs/share-input";
import { Field as SharedField } from "../inputs/field";
import { inputClass } from "../inputs/styles";
import { AllocationBar } from "./allocation-bar";
import { defaultShares } from "./split-shares.utils";
export function SplitRecipientsEditor({
  node,
  trigger,
  sourceAmount,
  addressBook,
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  fieldErrors,
  onChange,
  sandbox,
}: {
  node: Extract<
    FlowNode,
    {
      type: "split";
    }
  >;
  trigger: FlowNode | undefined;
  sourceAmount: string | undefined;
  addressBook: AddressEntry[];
  refreshAddressBook?: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  /** Per-field validation messages for this node, keyed by config path. */
  fieldErrors?: Map<string, string>;
  onChange: (n: FlowNode) => void;
  sandbox?: boolean;
}) {
  const onAddressBookChange = refreshAddressBook ?? (() => {});
  const listError = fieldErrors?.get("recipients") ?? null;
  const recipientError = (i: number, field: string): string | null =>
    fieldErrors?.get(`recipients.${i}.${field}`) ?? null;
  const triggerType = trigger?.type ?? null;
  const isStreamer = triggerType === "on_schedule";
  const mode = node.config.recipients[0]?.mode ?? "percentage";
  const totalFixed = splitTotalFixedStroops(node.config.recipients);
  const minAmount = trigger?.type === "on_receive" ? trigger.config.minAmountStroops : undefined;
  // For scheduled splits the projection base lives on the split itself: the
  // amount-per-interval field in percentage mode, or the sum of the fixed
  // amounts in fixed mode (to-params derives the same base).
  const projectionBase =
    sourceAmount ??
    (isStreamer
      ? mode === "fixed"
        ? (totalFixed ?? undefined)
        : node.config.amountPerIntervalStroops
      : undefined);
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
    // A recipient with no cached share gets an even part of what the cached
    // ones leave, so switching a fresh fixed split to percentage lands on a
    // valid 100% instead of writing 0 into every share (#583).
    const fresh = defaultShares(node.config.recipients.map((_, i) => modeCache.current.bps.get(i)));
    const next = node.config.recipients.map((r, i) => {
      const base = {
        address: r.address,
        label: r.label,
      };
      if (newMode === "percentage") {
        return { ...base, mode: "percentage" as const, bps: fresh[i] ?? 0 };
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
      <SharedField label="Distribution mode">
        {(control) => (
          <select
            {...control}
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as "percentage" | "fixed")}
          >
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        )}
      </SharedField>

      {isStreamer && (
        <div className="text-xs text-zinc-400">
          {mode === "percentage"
            ? "The amount per interval is divided among the recipients by their shares."
            : "Each recipient receives their fixed amount every interval."}
        </div>
      )}

      <div className={cn("text-xs", listError ? "text-error" : "text-zinc-400")}>
        {mode === "percentage"
          ? "Recipients (shares must sum to 100%)"
          : isStreamer
            ? "Recipients (each receives their amount every interval)"
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
        const isExpanded = expandedRecipients.has(i);
        const cardHasError = fieldErrors
          ? [...fieldErrors.keys()].some((k) => k.startsWith(`recipients.${i}.`))
          : false;
        const projected =
          isPercentage && projectionBase
            ? stroopsToDisplay(
                ((BigInt(projectionBase) * BigInt(r.bps)) / 10000n).toString(),
                node.config.asset,
              )
            : null;
        const summaryLabel = r.label ? r.label : shortAddr(r.address);
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
              aria-expanded={isExpanded}
              onClick={() => toggleRecipient(i)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-zinc-800/50"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-zinc-500">
                  {"account_circle"}
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
                <>
                  {/* Row 1: wallet address + delete */}
                  <div className="grid grid-cols-[1fr_auto] items-start gap-2">
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
                        label={`Wallet address for recipient ${i + 1}`}
                        error={recipientError(i, "address")}
                        addressBook={addressBook}
                        onAddressBookChange={onAddressBookChange}
                        addressBookLoading={addressBookLoading}
                        addressBookError={addressBookError}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove recipient ${i + 1}`}
                      onClick={() => deleteRecipient(i)}
                      className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-400 hover:text-red-300 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    >
                      ×
                    </button>
                  </div>

                  {isPercentage ? (
                    <ShareInput
                      label={`Share for ${summaryLabel}`}
                      error={recipientError(i, "bps")}
                      value={r.bps}
                      onChange={(bps) => updateRecipient(i, { ...r, bps })}
                    />
                  ) : (
                    <AmountInput
                      label={`Amount for ${summaryLabel}`}
                      error={recipientError(i, "amountStroops")}
                      value={r.amountStroops}
                      asset={node.config.asset}
                      commit="draft"
                      echo={false}
                      placeholder="0"
                      onChange={(amountStroops) => updateRecipient(i, { ...r, amountStroops })}
                    />
                  )}
                  <div className="grid grid-cols-[1fr_auto] gap-1">
                    <SharedField label={`Label for recipient ${i + 1}`}>
                      {(control) => (
                        <input
                          {...control}
                          className={inputClass}
                          value={r.label ?? ""}
                          placeholder="Label (e.g. Alice)"
                          onChange={(e) =>
                            updateRecipient(i, {
                              ...r,
                              label: e.target.value || undefined,
                            } as SplitRecipient)
                          }
                        />
                      )}
                    </SharedField>
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

                {!sandbox && (
                  <RecipientEmailField
                    shared
                    value={r.email}
                    onChange={(email) => updateRecipient(i, { ...r, email })}
                  />
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
          <div className="text-error text-xs">
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
            mode === "fixed"
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
function remainingPct(recipients: SplitRecipient[]): number {
  const used = recipients.reduce((s, r) => (r.mode === "percentage" ? s + r.bps : s), 0);
  return Math.max(0, (TOTAL_BPS - used) / 100);
}
