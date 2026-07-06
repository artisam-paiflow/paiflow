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

function getLimitEnv(name: keyof typeof DEFAULT_HARD_LIMITS): number {
  const envName = {
    xlmMin: "NEXT_PUBLIC_SPLITTER_XLM_MIN",
    xlmMax: "NEXT_PUBLIC_SPLITTER_XLM_MAX",
    usdcMin: "NEXT_PUBLIC_SPLITTER_USDC_MIN",
    usdcMax: "NEXT_PUBLIC_SPLITTER_USDC_MAX",
  }[name];
  const raw = process.env[envName];
  if (raw === undefined || raw === "") {
    return DEFAULT_HARD_LIMITS[name];
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_HARD_LIMITS[name];
  }
  return parsed;
}

export function splitterHardLimits(): {
  xlmMin: number;
  xlmMax: number;
  usdcMin: number;
  usdcMax: number;
} {
  return {
    xlmMin: getLimitEnv("xlmMin"),
    xlmMax: getLimitEnv("xlmMax"),
    usdcMin: getLimitEnv("usdcMin"),
    usdcMax: getLimitEnv("usdcMax"),
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
