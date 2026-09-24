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

/** Units of `assetOut` per one unit of `assetIn`, or null for a zero input. */
function rate(inStroops: string, outStroops: string): string | null {
  const amountIn = BigInt(inStroops);
  if (amountIn === 0n) return null;
  return units(((BigInt(outStroops) * STROOPS_PER_UNIT) / amountIn).toString());
}

/**
 * The builder shows a swap ticket: the output as the figure ("≈ 1.05 USDC"),
 * then the minimum and the rate. `compact` (deploy review) keeps one
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
  const slippage = `${slippageBps / 100}%`;

  if (compact) {
    const base = "text-label-sm text-on-surface-variant font-mono";
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
    return (
      <div
        className={alwaysReverts ? `${base} text-error` : base}
        data-testid="swap-quote"
        aria-live="polite"
      >
        {units(amountStroops, 7)} {label(assetIn)} → ~{units(quote.amountOutStroops)}{" "}
        {label(assetOut)} via Soroswap (live). Minimum at {slippage} slippage: ~
        {units(quote.amountOutMinStroops)} {label(assetOut)}
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

  if (state.status === "idle") return null;
  const outLabel = label(assetOut);
  const quote = state.status === "ok" ? state.quote : null;
  const alwaysReverts = quote !== null && quoteAlwaysReverts(quote);
  const perUnit = quote ? rate(amountStroops, quote.amountOutStroops) : null;

  return (
    <div
      className="grid gap-3"
      data-testid="swap-quote"
      aria-live="polite"
      aria-busy={state.status === "loading" || undefined}
      role={state.status === "error" ? "status" : undefined}
    >
      <div aria-hidden className="text-on-surface-muted flex items-center gap-2">
        <span className="bg-outline-variant/40 h-px flex-1" />
        <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
        <span className="bg-outline-variant/40 h-px flex-1" />
      </div>
      <div className="grid gap-1">
        <span className="text-label-sm text-on-surface-muted font-body font-medium">You get</span>
        {state.status === "loading" && (
          <>
            <span
              aria-hidden
              className="bg-surface-container-highest h-7 w-40 animate-pulse rounded motion-reduce:animate-none"
            />
            <span className="sr-only">Fetching a live Soroswap quote…</span>
          </>
        )}
        {state.status === "error" && (
          <span className="text-label-sm text-error font-body flex min-h-7 items-center leading-snug">
            {state.message}
          </span>
        )}
        {quote && (
          <span
            className={`font-mono text-[20px] leading-7 tabular-nums ${alwaysReverts ? "text-error" : "text-primary"}`}
          >
            ≈ {units(quote.amountOutStroops)} {outLabel}
          </span>
        )}
      </div>
      {quote && (
        <dl className="text-label-sm grid gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-muted font-body">Minimum ({slippage})</dt>
            <dd className="text-on-surface font-mono tabular-nums">
              {units(quote.amountOutMinStroops)} {outLabel}
            </dd>
          </div>
          {perUnit !== null && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-on-surface-muted font-body">Rate</dt>
              <dd className="text-on-surface font-mono tabular-nums">
                1 {label(assetIn)} = {perUnit} {outLabel}
              </dd>
            </div>
          )}
        </dl>
      )}
      {alwaysReverts ? (
        <p className="text-label-sm text-error font-body leading-snug">
          Would always revert: the minimum is above the expected output. Raise the slippage.
        </p>
      ) : (
        quote && (
          <p className="text-label-sm text-on-surface-muted font-body flex items-center gap-2">
            <span aria-hidden className="status-dot-live" />
            Live · Soroswap
          </p>
        )
      )}
    </div>
  );
}
