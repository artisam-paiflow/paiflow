"use client";

import type { Asset } from "@/lib/flows/schema";
import { AssetSelect } from "../inputs/asset-select";

/** Non-swap nodes accept an upstream custom asset; retain that read-only adoption policy. */
export function NodeAssetField({
  asset,
  onChange,
  expectedAsset,
  error,
}: {
  asset: Asset;
  onChange: (asset: Asset) => void;
  expectedAsset?: Asset | null;
  error?: string | null;
}) {
  return (
    <AssetSelect
      label="Asset"
      value={asset}
      onChange={onChange}
      expectedAsset={expectedAsset}
      error={error}
      onUpstreamCustom="adopt"
    />
  );
}
