import { describe, expect, it } from "vitest";
import {
  ASSET_CATALOGUE,
  assetOptionValue,
  catalogueEntry,
  isCatalogueAsset,
} from "@/lib/flows/asset-catalogue";
import { AssetSchema } from "@/lib/flows/schema";

describe("asset catalogue", () => {
  it("holds only assets the schema accepts, with unique option values", () => {
    for (const entry of ASSET_CATALOGUE) {
      expect(AssetSchema.parse(entry.asset)).toEqual(entry.asset);
    }
    expect(new Set(ASSET_CATALOGUE.map((e) => e.value)).size).toBe(ASSET_CATALOGUE.length);
  });

  it("round-trips each entry through its option value", () => {
    for (const entry of ASSET_CATALOGUE) {
      expect(assetOptionValue(entry.asset)).toBe(entry.value);
      expect(catalogueEntry(entry.value)).toBe(entry);
    }
  });

  it("accepts native and USDC and refuses a custom asset, even one coded USDC", () => {
    expect(isCatalogueAsset({ kind: "native" })).toBe(true);
    expect(isCatalogueAsset({ kind: "known", symbol: "USDC" })).toBe(true);
    expect(
      isCatalogueAsset({
        kind: "custom",
        code: "USDC",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      }),
    ).toBe(false);
    expect(catalogueEntry("custom:USDC:G")).toBeUndefined();
  });
});
