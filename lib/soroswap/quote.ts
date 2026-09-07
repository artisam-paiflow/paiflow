/**
 * Pure helpers for the Soroswap quote preview (Instawards D1, #391).
 *
 * The maths mirrors `contracts/actions/swapper` exactly: the contract's
 * minimum output is the pool's spot price less `slippageBps`, so the preview
 * shows the same number the contract will enforce.
 */
import { z } from "zod";
import type { Asset } from "@/lib/flows/schema";
import { StrKey } from "@stellar/stellar-sdk";

export const TOTAL_BPS = 10_000n;

/** `native`, `USDC`, or `CODE:GISSUER…` for a custom classic asset. */
export function parseAssetParam(raw: string): Asset {
  if (raw === "native") return { kind: "native" };
  if (raw === "USDC") return { kind: "known", symbol: "USDC" };
  const [code, issuer] = raw.split(":");
  if (
    code &&
    issuer &&
    /^[A-Za-z0-9]{1,12}$/.test(code) &&
    StrKey.isValidEd25519PublicKey(issuer)
  ) {
    return { kind: "custom", code, issuer };
  }
  throw new Error(`Unrecognised asset "${raw}"`);
}

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

const assetParam = z
  .string()
  .min(1)
  .transform((s, ctx) => {
    try {
      return parseAssetParam(s);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unrecognised asset" });
      return z.NEVER;
    }
  });

export const QuoteQuerySchema = z
  .object({
    assetIn: assetParam,
    assetOut: assetParam,
    amountStroops: z.string().regex(/^[1-9]\d{0,38}$/, "Must be a positive integer in stroops"),
    slippageBps: z.coerce.number().int().min(0).max(10_000).default(100),
  })
  .refine((q) => assetToParam(q.assetIn) !== assetToParam(q.assetOut), {
    message: "assetIn and assetOut must differ",
    path: ["assetOut"],
  });
export type QuoteQuery = z.infer<typeof QuoteQuerySchema>;

/** `amount * reserveOut / reserveIn`, as the contract computes it. */
export function spotOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  return (amountIn * reserveOut) / reserveIn;
}

/** `spot * (10_000 - slippageBps) / 10_000`, as the contract computes it. */
export function minOut(spot: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) throw new RangeError("slippageBps out of range");
  return (spot * (TOTAL_BPS - BigInt(slippageBps))) / TOTAL_BPS;
}

/** Orient `(reserve0, reserve1)` so the first element is `assetIn`'s side. */
export function orientReserves(
  reserve0: bigint,
  reserve1: bigint,
  token0IsAssetIn: boolean,
): { reserveIn: bigint; reserveOut: bigint } {
  return token0IsAssetIn
    ? { reserveIn: reserve0, reserveOut: reserve1 }
    : { reserveIn: reserve1, reserveOut: reserve0 };
}

export type SoroswapQuote = {
  /** Expected output from the router's own quote (fee and impact included). */
  amountOutStroops: string;
  /** The minimum the swapper contract will enforce. */
  amountOutMinStroops: string;
  pairAddress: string;
  routerAddress: string;
};
