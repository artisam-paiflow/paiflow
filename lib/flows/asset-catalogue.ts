import type { Asset } from "./schema";

export type CatalogueEntry = {
  /** The `<option value>`; stable, so a saved selection survives a reorder. */
  value: string;
  asset: Asset;
  label: string;
};

/**
 * The assets a builder node may select. One list for the picker and for
 * `validateFlow`, so the browser and the server refuse the same things.
 * Issuers are not here: a known asset's issuer is per-network and resolved
 * server-side in `lib/stellar/assets.ts`, which this client-safe module must
 * not import.
 */
export const ASSET_CATALOGUE: readonly CatalogueEntry[] = [
  { value: "known:USDC", asset: { kind: "known", symbol: "USDC" }, label: "USDC" },
  { value: "native", asset: { kind: "native" }, label: "XLM (native)" },
];

export function assetOptionValue(asset: Asset): string {
  switch (asset.kind) {
    case "native":
      return "native";
    case "known":
      return `known:${asset.symbol}`;
    case "custom":
      return `custom:${asset.code}:${asset.issuer}`;
    default: {
      const exhaustive: never = asset;
      return exhaustive;
    }
  }
}

export function catalogueEntry(
  value: string,
  options: readonly CatalogueEntry[] = ASSET_CATALOGUE,
): CatalogueEntry | undefined {
  return options.find((o) => o.value === value);
}

// Compared by option value rather than `assetsEqual` from validate.ts, which
// would pull that module (and @prisma/client) into this one and into the
// client bundle, and cycle once validateFlow imports the catalogue.
export function isCatalogueAsset(
  asset: Asset,
  options: readonly CatalogueEntry[] = ASSET_CATALOGUE,
): boolean {
  return catalogueEntry(assetOptionValue(asset), options) !== undefined;
}
