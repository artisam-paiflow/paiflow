"use client";

import { useEffect } from "react";
import {
  ASSET_CATALOGUE,
  assetOptionValue,
  catalogueEntry,
  type CatalogueEntry,
} from "@/lib/flows/asset-catalogue";
import type { Asset } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";
import { shortAddr } from "@/lib/utils";
import { Field } from "./field";
import { inputClass, readoutClass } from "./styles";

type Props = {
  label: React.ReactNode;
  value: Asset;
  onChange: (asset: Asset) => void;
  error?: string | null;
  hint?: React.ReactNode;
  /** The asset flowing in from upstream; options that differ are disabled. */
  expectedAsset?: Asset | null;
  options?: readonly CatalogueEntry[];
  disabled?: boolean;
  /**
   * What to do when upstream delivers an asset outside `options`, which no
   * option could match. `"adopt"` writes it into the node (the legacy
   * behaviour); `"error"` shows it and says so, and writes nothing.
   */
  onUpstreamCustom?: "adopt" | "error";
};

function describeAsset(asset: Asset): string {
  return asset.kind === "custom"
    ? `${asset.code} (issuer ${shortAddr(asset.issuer)})`
    : assetLabel(asset);
}

export function AssetSelect({
  label,
  value,
  onChange,
  error,
  hint,
  expectedAsset,
  options = ASSET_CATALOGUE,
  disabled,
  onUpstreamCustom = "error",
}: Props) {
  const upstreamOutside =
    expectedAsset && !catalogueEntry(assetOptionValue(expectedAsset), options)
      ? expectedAsset
      : null;
  const adopt = upstreamOutside !== null && onUpstreamCustom === "adopt";
  const adoptNeeded = adopt && assetOptionValue(upstreamOutside) !== assetOptionValue(value);

  useEffect(() => {
    if (adoptNeeded) onChange(upstreamOutside);
  }, [adoptNeeded, upstreamOutside, onChange]);

  if (upstreamOutside) {
    const policyError = adopt
      ? null
      : `The step before this one delivers ${describeAsset(upstreamOutside)}, which this field cannot take. Change the upstream step to send one of: ${options.map((o) => o.label).join(", ")}.`;
    return (
      <Field
        label={label}
        hint={hint ?? "Set by the asset flowing into this step."}
        error={policyError ?? error}
      >
        {(control) => (
          <output {...control} className={readoutClass}>
            {describeAsset(upstreamOutside)}
          </output>
        )}
      </Field>
    );
  }

  const selected = assetOptionValue(value);
  const known = catalogueEntry(selected, options) !== undefined;
  const expectedValue = expectedAsset ? assetOptionValue(expectedAsset) : null;
  const restriction = expectedAsset ? "Set by the previous step." : null;

  return (
    <Field
      label={label}
      hint={
        restriction || hint ? (
          <>
            {hint}
            {hint && restriction ? " " : null}
            {restriction}
          </>
        ) : undefined
      }
      error={error}
    >
      {(control) => (
        <select
          {...control}
          className={inputClass}
          value={selected}
          disabled={disabled}
          onChange={(e) => {
            const entry = catalogueEntry(e.target.value, options);
            if (entry) onChange(entry.asset);
          }}
        >
          {!known && (
            // A saved value the catalogue no longer offers: show it rather
            // than letting the browser display the first option as selected.
            <option value={selected} disabled>
              {describeAsset(value)} (not available)
            </option>
          )}
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              disabled={expectedValue !== null && o.value !== expectedValue}
            >
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
