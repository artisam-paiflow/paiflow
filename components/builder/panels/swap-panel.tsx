"use client";

import { useState } from "react";
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

  return (
    <>
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
        onUpstreamCustom="error"
      />
      <div data-testid="swap-router">
        {/* Pinned, never editable: the server resolves the router per
            environment and injects it at deploy time. An editable router
            would let a flow route its funds through an arbitrary contract. */}
        <AddressPicker
          pinned={{ id: routerContractId, label: `Router — Soroswap (${network})`, network }}
          hint="Set by Paiflow for this network and applied when you deploy. It can't be changed here."
        />
      </div>
      <ShareInput
        label="Max slippage (%)"
        value={node.config.slippageBps}
        onChange={(slippageBps) => set({ slippageBps })}
        minBps={MIN_SWAP_SLIPPAGE_BPS}
        error={fieldError("slippageBps")}
        hint={
          <>
            Minimum output is the pool&apos;s spot price less this percentage. It must cover
            Soroswap&apos;s 0.3% fee plus price impact, so at least 0.3% is required.
          </>
        }
      />
      <DeadlineInput
        value={node.config.deadlineSecs}
        onChange={(deadlineSecs) => set({ deadlineSecs })}
        error={fieldError("deadlineSecs")}
      />
      <AmountInput
        label="Preview amount"
        value={previewStroops}
        onChange={setPreviewStroops}
        asset={node.config.assetIn}
        hint="Used for this preview only — a swap converts whatever the flow receives."
      />
      <SwapQuotePreview
        assetIn={node.config.assetIn}
        assetOut={node.config.assetOut}
        slippageBps={node.config.slippageBps}
        amountStroops={previewStroops}
      />
    </>
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
      hint="Bounds the ledger close time the router accepts. On the direct trigger path it is computed in the same transaction and cannot expire."
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
