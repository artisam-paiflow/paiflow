"use client";
import type { Asset } from "@/lib/flows/schema";
import { useSoroswapQuote } from "@/lib/hooks/use-soroswap-quote";
import { assetToParam } from "@/lib/soroswap/asset-param";
import { quoteAlwaysReverts } from "@/lib/soroswap/preview";

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
 * The builder shows the output as a figure ("≈ 1.05 USDC", then "for 10 XLM ·
 * at least 1.04 USDC at 1% slippage"); `compact` (deploy review) keeps the one
 * sentence: "10 XLM → ~1.05 USDC via Soroswap (live). Minimum at 1% slippage:
 * ~1.04 USDC". The minimum is the spot-based number the swapper contract
 * enforces, not the quote less slippage. Instawards D1, #391.
 */
export default function SwapQuotePreview({
  assetIn,
  assetOut,
  slippageBps,
  amountStroops = (SAMPLE_UNITS * STROOPS_PER_UNIT).toString(),
  compact = false,
}: {
  assetIn: Asset;
  assetOut: Asset;
  slippageBps: number;
  /** The size to quote, in stroops. Pass committed values only: each change fetches. */
  amountStroops?: string;
  compact?: boolean;
}) {
  const state = useSoroswapQuote(
    assetToParam(assetIn) === assetToParam(assetOut)
      ? null
      : { assetIn, assetOut, amountStroops, slippageBps },
  );
  const base = compact
    ? "text-label-sm text-on-surface-variant font-mono"
    : "text-label-sm text-on-surface-muted font-body leading-snug";

  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className={base} data-testid="swap-quote" aria-live="polite" aria-busy="true">
        Fetching a live Soroswap quote…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        className={`${base} text-error`}
        data-testid="swap-quote"
        aria-live="polite"
        role="status"
      >
        {state.message}
      </div>
    );
  }
  const { quote } = state;
  const alwaysReverts = quoteAlwaysReverts(quote);
  const inText = `${units(amountStroops, 7)} ${label(assetIn)}`;
  const outText = `${units(quote.amountOutStroops)} ${label(assetOut)}`;
  const minText = `${units(quote.amountOutMinStroops)} ${label(assetOut)}`;
  const slippage = `${slippageBps / 100}%`;

  if (compact) {
    return (
      <div
        className={alwaysReverts ? `${base} text-error` : base}
        data-testid="swap-quote"
        aria-live="polite"
      >
        {inText} → ~{outText} via Soroswap (live). Minimum at {slippage} slippage: ~{minText}
        {alwaysReverts && (
          <>
            {" "}
            — above the router&apos;s expected output, so this swap would always revert. Raise the
            slippage allowance to cover the 0.3% pool fee and price impact.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-0.5" data-testid="swap-quote" aria-live="polite">
      <div
        className={`font-mono text-[18px] leading-tight ${alwaysReverts ? "text-error" : "text-primary"}`}
      >
        ≈ {outText}
      </div>
      <div className={alwaysReverts ? `${base} text-error` : base}>
        {alwaysReverts
          ? `Would always revert: at ${slippage} slippage the minimum, ${minText}, is above the expected output. Raise the slippage.`
          : `for ${inText} · at least ${minText} at ${slippage} slippage · live Soroswap quote`}
      </div>
    </div>
  );
}
