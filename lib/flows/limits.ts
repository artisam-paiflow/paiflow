import { assetLabel, tokenAmountToStroops, type Asset } from "./schema";

export type ValidationIssue = {
  path: string;
  message: string;
  friendlyMessage: string;
};

export const DEFAULT_HARD_LIMITS = {
  xlmMin: 150,
  xlmMax: 500,
  usdcMin: 30,
  usdcMax: 110,
} as const;

// Lenient on purpose: these are temporary business-rule knobs. A malformed or
// negative value falls back to the default rather than throwing, so a bad env
// value can never take down validation (and must never take down env() — see
// the matching .catch() entries in lib/env.ts).
function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function splitterHardLimits(): {
  xlmMin: number;
  xlmMax: number;
  usdcMin: number;
  usdcMax: number;
} {
  // IMPORTANT: reference each NEXT_PUBLIC_* var by its literal name. Next.js
  // only inlines these values into the client bundle for statically-analyzable
  // `process.env.NEXT_PUBLIC_X` accesses; a computed key (process.env[name])
  // is never replaced, so validateFlow in the browser would silently fall back
  // to DEFAULT_HARD_LIMITS regardless of the deployed configuration.
  return {
    xlmMin: parseLimit(process.env.NEXT_PUBLIC_SPLITTER_XLM_MIN, DEFAULT_HARD_LIMITS.xlmMin),
    xlmMax: parseLimit(process.env.NEXT_PUBLIC_SPLITTER_XLM_MAX, DEFAULT_HARD_LIMITS.xlmMax),
    usdcMin: parseLimit(process.env.NEXT_PUBLIC_SPLITTER_USDC_MIN, DEFAULT_HARD_LIMITS.usdcMin),
    usdcMax: parseLimit(process.env.NEXT_PUBLIC_SPLITTER_USDC_MAX, DEFAULT_HARD_LIMITS.usdcMax),
  };
}

export function hardLimitsForAsset(
  asset: Asset,
): { minStroops: string; maxStroops: string } | null {
  const limits = splitterHardLimits();
  switch (asset.kind) {
    case "native":
      return {
        minStroops: tokenAmountToStroops(String(limits.xlmMin)),
        maxStroops: tokenAmountToStroops(String(limits.xlmMax)),
      };
    case "known":
      if (asset.symbol === "USDC") {
        return {
          minStroops: tokenAmountToStroops(String(limits.usdcMin)),
          maxStroops: tokenAmountToStroops(String(limits.usdcMax)),
        };
      }
      return null;
    case "custom":
      return null;
    default:
      return null;
  }
}

export function checkHardLimits(asset: Asset, amountStroops: string): ValidationIssue | null {
  const limits = hardLimitsForAsset(asset);
  if (!limits) return null;

  const min = BigInt(limits.minStroops);
  const max = BigInt(limits.maxStroops);
  const amount = BigInt(amountStroops);
  const label = assetLabel(asset);

  if (max > 0n && amount > max) {
    const maxTokens = Number(max) / 10_000_000;
    return {
      path: "",
      message: `Amount ${amountStroops} stroops exceeds temporary maximum of ${maxTokens} ${label}`,
      friendlyMessage: `Amount exceeds the temporary maximum of ${maxTokens.toLocaleString()} ${label}.`,
    };
  }

  if (min > 0n && amount < min) {
    const minTokens = Number(min) / 10_000_000;
    return {
      path: "",
      message: `Amount ${amountStroops} stroops is below temporary minimum of ${minTokens} ${label}`,
      friendlyMessage: `Amount is below the temporary minimum of ${minTokens.toLocaleString()} ${label}.`,
    };
  }

  return null;
}
