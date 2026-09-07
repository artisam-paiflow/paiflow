"use client";
import type { Asset } from "@/lib/flows/schema";
import { useSoroswapQuote } from "@/lib/hooks/use-soroswap-quote";

const SAMPLE_UNITS = 10n;
const STROOPS_PER_UNIT = 10_000_000n;

function label(asset: Asset): string {
  switch (asset.kind) {
    case "native":
      return "XLM";
    case "known":
      return asset.symbol;
    case "custom":
      return asset.code;
  }
}

function units(stroops: string, maxFrac = 4): string {
  const n = BigInt(stroops);
  const whole = n / STROOPS_PER_UNIT;
  const frac = (n % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, "0")
    .slice(0, maxFrac)
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * "10 XLM → ~1.05 USDC via Soroswap (live). Minimum at 1% slippage: ~1.04 USDC"
 * The minimum is the spot-based number the swapper contract enforces, not the
 * quote less slippage. Instawards D1, #391.
 */
export default function SwapQuotePreview({
  assetIn,
  assetOut,
  slippageBps,
  compact = false,
}: {
  assetIn: Asset;
  assetOut: Asset;
  slippageBps: number;
  compact?: boolean;
}) {
  const sample = (SAMPLE_UNITS * STROOPS_PER_UNIT).toString();
  const state = useSoroswapQuote({ assetIn, assetOut, amountStroops: sample, slippageBps });
  const base = compact
    ? "text-label-sm text-on-surface-variant font-mono"
    : "text-[11px] text-zinc-400";

  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className={base} data-testid="swap-quote" aria-busy="true">
        Fetching a live Soroswap quote…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={`${base} text-error`} data-testid="swap-quote" role="status">
        {state.message}
      </div>
    );
  }
  const { quote } = state;
  return (
    <div className={base} data-testid="swap-quote">
      {SAMPLE_UNITS.toString()} {label(assetIn)} → ~{units(quote.amountOutStroops)}{" "}
      {label(assetOut)} via Soroswap (live). Minimum at {slippageBps / 100}% slippage: ~
      {units(quote.amountOutMinStroops)} {label(assetOut)}
    </div>
  );
}
