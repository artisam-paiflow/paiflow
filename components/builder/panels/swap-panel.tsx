"use client";

import { useEffect, useState } from "react";
import SwapQuotePreview from "@/components/builder/swap-quote-preview";
import type { Asset, FlowNode } from "@/lib/flows/schema";
import { MIN_SWAP_SLIPPAGE_BPS } from "@/lib/flows/schema";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import { AddressPicker } from "../inputs/address-picker";
import { AmountInput } from "../inputs/amount-input";
import { AssetSelect } from "../inputs/asset-select";
import { Field } from "../inputs/field";
import { ShareInput } from "../inputs/share-input";
import { inputClass, suffixClass } from "../inputs/styles";
import { useDraftNumber } from "../inputs/use-draft-number";

type SwapNode = Extract<FlowNode, { type: "swap" }>;

type Props = {
  node: SwapNode;
  onChange: (n: FlowNode) => void;
  fieldError: (field: string) => string | null;
  expectedAsset: Asset | null;
  network: StellarNetwork;
  /** The router this environment resolves to; `undefined` renders as unconfigured. */
  routerContractId?: string;
};

// The quote's default size, matching SwapQuotePreview's own: 10 whole units.
const DEFAULT_PREVIEW_STROOPS = "100000000";

const MAX_DEADLINE_SECS = 86_400;

export default function SwapPanel({
  node,
  onChange,
  fieldError,
  expectedAsset,
  network,
  routerContractId,
}: Props) {
  // UI state only, never written to the graph: a swap converts whatever the
  // flow receives, so this sizes the quote and nothing else.
  const [previewStroops, setPreviewStroops] = useState(DEFAULT_PREVIEW_STROOPS);
  const set = (config: Partial<SwapNode["config"]>) =>
    onChange({ ...node, config: { ...node.config, ...config } });

  // Advanced starts collapsed, but never hides a problem: a deadline error or
  // a missing router opens it.
  const deadlineError = fieldError("deadlineSecs");
  const advancedNeedsAttention = deadlineError !== null || routerContractId === undefined;
  const [advancedOpen, setAdvancedOpen] = useState(advancedNeedsAttention);
  useEffect(() => {
    if (advancedNeedsAttention) setAdvancedOpen(true);
  }, [advancedNeedsAttention]);

  return (
    <div className="grid gap-4">
      <AssetSelect
        label="Asset In"
        value={node.config.assetIn}
        onChange={(assetIn) => set({ assetIn })}
        expectedAsset={expectedAsset}
        error={fieldError("assetIn")}
        onUpstreamCustom="error"
      />
      <AssetSelect
        label="Asset Out"
        value={node.config.assetOut}
        onChange={(assetOut) => set({ assetOut })}
        error={fieldError("assetOut")}
      />
      <ShareInput
        label="Max slippage (%)"
        value={node.config.slippageBps}
        onChange={(slippageBps) => set({ slippageBps })}
        minBps={MIN_SWAP_SLIPPAGE_BPS}
        error={fieldError("slippageBps")}
        hint="At least 0.3%, to cover Soroswap's fee and price impact."
      />
      <section
        aria-label="Live quote"
        className="border-outline-variant/40 bg-surface-container grid gap-3 rounded border p-3"
      >
        <AmountInput
          label="Preview amount"
          value={previewStroops}
          onChange={setPreviewStroops}
          asset={node.config.assetIn}
          hint="Preview only; the swap converts whatever arrives."
          emptyNote={(described) => `Empty — the preview still quotes ${described}.`}
        />
        <SwapQuotePreview
          assetIn={node.config.assetIn}
          assetOut={node.config.assetOut}
          slippageBps={node.config.slippageBps}
          amountStroops={previewStroops}
        />
      </section>
      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        className="group/advanced"
        data-testid="swap-advanced"
      >
        <summary className="text-label-sm text-on-surface-muted hover:text-on-surface focus-visible:ring-primary font-body flex cursor-pointer list-none items-center gap-1 rounded font-medium focus:outline-none focus-visible:ring-1 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="material-symbols-outlined text-[18px] transition-transform group-open/advanced:rotate-90 motion-reduce:transition-none"
          >
            chevron_right
          </span>
          Advanced
          <span className="font-normal">· router, deadline</span>
        </summary>
        <div className="mt-3 grid gap-4">
          <div data-testid="swap-router">
            {/* Pinned, never editable: the server resolves the router per
                environment and injects it at deploy time. An editable router
                would let a flow route its funds through an arbitrary contract. */}
            <AddressPicker
              pinned={{ id: routerContractId, label: `Router — Soroswap (${network})`, network }}
              hint="Set by Paiflow for this network; it can't be changed."
            />
          </div>
          <DeadlineInput
            value={node.config.deadlineSecs}
            onChange={(deadlineSecs) => set({ deadlineSecs })}
            error={deadlineError}
          />
        </div>
      </details>
    </div>
  );
}

/** Whole seconds within the schema's 1–86,400 (`SwapAction.deadlineSecs`). */
function DeadlineInput({
  value,
  onChange,
  error,
}: {
  value: number;
  onChange: (secs: number) => void;
  error: string | null;
}) {
  const { note, inputProps } = useDraftNumber({
    value: Number.isSafeInteger(value) ? BigInt(value) : null,
    // Safe: the hook only commits within [1, 86,400].
    onChange: (units) => onChange(Number(units)),
    decimals: 0,
    min: 1n,
    max: BigInt(MAX_DEADLINE_SECS),
    describe: (units) => `${units} seconds`,
  });

  return (
    <Field
      label="Deadline (seconds)"
      hint="How long the router accepts the swap after it is submitted."
      note={note}
      error={error}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <input {...control} {...inputProps} inputMode="numeric" className={inputClass} />
          <span aria-hidden className={suffixClass}>
            s
          </span>
        </div>
      )}
    </Field>
  );
}
