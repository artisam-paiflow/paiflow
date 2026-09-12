/**
 * The one Soroswap helper the browser needs, split out of `quote.ts`.
 *
 * `quote.ts` imports `zod` and `StrKey` at module scope, and both the swap panel
 * and the deploy review serialize an asset for the quote query. `deploy-review.tsx`
 * keeps `@stellar/stellar-sdk` out of the deploy route on purpose — type-only
 * schema imports, literal network passphrases, a lazily imported wallet kit — so a
 * static import of `quote.ts` from that tree would undo it.
 */
import type { Asset } from "@/lib/flows/schema";

/** `native`, `USDC`, or `CODE:GISSUER…` for a custom classic asset. */
export function assetToParam(asset: Asset): string {
  switch (asset.kind) {
    case "native":
      return "native";
    case "known":
      return asset.symbol;
    case "custom":
      return `${asset.code}:${asset.issuer}`;
  }
}
