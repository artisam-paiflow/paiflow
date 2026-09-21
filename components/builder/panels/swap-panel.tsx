"use client";

import SwapQuotePreview from "@/components/builder/swap-quote-preview";
import type { Asset, FlowNode } from "@/lib/flows/schema";
import { MIN_SWAP_SLIPPAGE_BPS } from "@/lib/flows/schema";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import { AssetSimpleSelect, Field } from "./asset-fields";

type Props = {
  node: Extract<FlowNode, { type: "swap" }>;
  onChange: (n: FlowNode) => void;
  fieldError: (field: string) => string | null;
  expectedAsset: Asset | null;
  network: StellarNetwork;
  /** The router this environment resolves to. Unused until #612 names it on the panel. */
  routerContractId?: string;
};

export default function SwapPanel({ node, onChange, fieldError, expectedAsset, network }: Props) {
  return (
    <>
      <AssetSimpleSelect
        label="Asset In"
        asset={node.config.assetIn}
        onChange={(assetIn) =>
          onChange({ ...node, config: { ...node.config, assetIn } } as FlowNode)
        }
        expectedAsset={expectedAsset}
        error={fieldError("assetIn")}
      />
      <AssetSimpleSelect
        label="Asset Out"
        asset={node.config.assetOut}
        onChange={(assetOut) =>
          onChange({ ...node, config: { ...node.config, assetOut } } as FlowNode)
        }
        error={fieldError("assetOut")}
      />
      <Field label="Router">
        {/* One option, disabled: the router address is pinned per environment
            on the server and injected at deploy time. Soroswap redeploys its
            testnet router on every reset, so a user-typed address would go
            stale and widen the trust surface. */}
        <select className="input" disabled value="soroswap" data-testid="swap-router">
          <option value="soroswap">Soroswap ({network})</option>
        </select>
      </Field>
      <Field label="Max slippage (%)" error={fieldError("slippageBps")}>
        <input
          className="input"
          type="number"
          min={MIN_SWAP_SLIPPAGE_BPS / 100}
          max={100}
          step={0.1}
          value={node.config.slippageBps / 100}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({
              ...node,
              config: {
                ...node.config,
                slippageBps: isNaN(v)
                  ? 100
                  : Math.max(
                      MIN_SWAP_SLIPPAGE_BPS,
                      Math.round(Math.min(100, Math.max(0, v)) * 100),
                    ),
              },
            });
          }}
        />
        <div className="mt-0.5 text-[11px] text-zinc-500">
          Minimum output is the pool&apos;s spot price less this percentage. It must cover
          Soroswap&apos;s 0.3% fee plus price impact, so at least 0.3% is required.
        </div>
      </Field>
      <Field label="Deadline (seconds)" error={fieldError("deadlineSecs")}>
        <input
          className="input"
          type="number"
          min={1}
          max={86400}
          value={node.config.deadlineSecs}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({
              ...node,
              config: {
                ...node.config,
                // Clamped to the schema's bound so the panel and the server agree.
                deadlineSecs: isNaN(v) ? 300 : Math.min(86_400, Math.max(1, Math.floor(v))),
              },
            });
          }}
        />
        <div className="mt-0.5 text-[11px] text-zinc-500">
          Bounds the ledger close time the router accepts. On the direct trigger path it is computed
          in the same transaction and cannot expire.
        </div>
      </Field>
      <SwapQuotePreview
        assetIn={node.config.assetIn}
        assetOut={node.config.assetOut}
        slippageBps={node.config.slippageBps}
      />
    </>
  );
}
