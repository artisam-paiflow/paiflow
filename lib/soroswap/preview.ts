/**
 * Browser-safe preview logic, kept out of `quote.ts` for the same reason
 * `asset-param.ts` is: `quote.ts` imports `zod` and `StrKey` at module scope,
 * and `deploy-review.tsx` keeps `@stellar/stellar-sdk` out of the deploy route.
 */
import type { SoroswapQuote } from "@/lib/soroswap/quote";

/**
 * True when the bound the contract enforces sits above what the router will
 * actually return, so `do_swap`'s `amount_out_min` assertion can never pass.
 *
 * The minimum is the pool's spot price less `slippageBps`, while the router's
 * output has the 0.3% pool fee and this swap's price impact already deducted —
 * so a `slippageBps` that doesn't cover both produces a swap that reverts every
 * time. `lib/flows/schema.ts` accepts a slippage that low and nothing in
 * `lib/flows/validate.ts` rejects it, which makes the preview the only place an
 * operator can see it before signing.
 */
export function quoteAlwaysReverts(
  quote: Pick<SoroswapQuote, "amountOutStroops" | "amountOutMinStroops">,
): boolean {
  return BigInt(quote.amountOutMinStroops) > BigInt(quote.amountOutStroops);
}
