"use client";

import { useEffect } from "react";
import type { Asset } from "@/lib/flows/schema";
import { assetLabel } from "@/lib/flows/schema";
import { cn } from "@/lib/utils";
import { assetsEqual } from "@/lib/flows/validate";
import { useField } from "../inputs/field";

export function Field({
  label,
  error,
  children,
}: {
  label: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className={cn("text-xs", error ? "text-error" : "text-zinc-400")}>{label}</span>
      <div className={cn("grid gap-1", error && "[&_.input]:!border-error/70")}>{children}</div>
      {error && <span className="text-error text-[11px] leading-snug">{error}</span>}
    </label>
  );
}

export function AssetOptionInfoIcon({ expectedAsset }: { expectedAsset: Asset }) {
  return (
    // Hidden from AT: the ligature text "info" would otherwise join the
    // select's accessible name ("Asset info").
    <span
      aria-hidden="true"
      className="material-symbols-outlined cursor-help text-[14px] text-zinc-500"
      title={`Only ${assetLabel(expectedAsset)} can be picked here — that's the asset flowing into this step. Add or change a swap node upstream to use a different asset.`}
    >
      info
    </span>
  );
}

export type SimpleAsset =
  | { kind: "native" }
  | { kind: "known"; symbol: "USDC" }
  | { kind: "custom"; code: string; issuer: string };

export function AssetFieldLabel({
  label,
  expectedAsset,
}: {
  label: React.ReactNode;
  expectedAsset?: Asset | null;
}) {
  if (!expectedAsset) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <AssetOptionInfoIcon expectedAsset={expectedAsset} />
    </span>
  );
}

/**
 * The dropdown below only offers native/USDC. When the upstream trigger
 * carries a custom asset, neither option is valid — rather than disabling
 * both and leaving the field dead, show the required asset read-only and
 * force the node's config to match it, since there is no other value the
 * user could legitimately pick.
 */
export function AssetSelectOrReadout({
  label,
  asset,
  onChange,
  expectedAsset,
  error,
}: {
  label: React.ReactNode;
  asset: SimpleAsset;
  onChange: (a: SimpleAsset) => void;
  expectedAsset?: Asset | null;
  error?: string | null;
}) {
  useEffect(() => {
    if (expectedAsset?.kind === "custom" && !assetsEqual(expectedAsset, asset)) {
      onChange(expectedAsset);
    }
  }, [expectedAsset, asset, onChange]);

  // Wired like `inputs/field.tsx` (#607): the error sits outside the label, so
  // it is not read as part of the control's name, and describes the control
  // instead. Always mounted and polite, so it is announced once when an
  // autosave's validation puts it there.
  const { controlId, errorId, controlProps } = useField({ error });
  const shell = (control: React.ReactNode) => (
    <div className="grid gap-1">
      <label htmlFor={controlId} className={cn("text-xs", error ? "text-error" : "text-zinc-400")}>
        <AssetFieldLabel label={label} expectedAsset={expectedAsset} />
      </label>
      <div className={cn("grid gap-1", error && "[&_.input]:!border-error/70")}>{control}</div>
      <p
        id={errorId}
        aria-live="polite"
        className={error ? "text-error text-[11px] leading-snug" : "sr-only"}
      >
        {error ?? ""}
      </p>
    </div>
  );

  if (expectedAsset?.kind === "custom") {
    return shell(
      <output {...controlProps} className="input flex items-center text-zinc-400">
        {assetLabel(expectedAsset)}
      </output>,
    );
  }

  const nativeDisabled = !!expectedAsset && !assetsEqual(expectedAsset, { kind: "native" });
  const usdcDisabled =
    !!expectedAsset && !assetsEqual(expectedAsset, { kind: "known", symbol: "USDC" });
  return shell(
    <select
      {...controlProps}
      className="input"
      value={asset.kind === "known" ? `known:${asset.symbol}` : asset.kind}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "native") onChange({ kind: "native" });
        else if (v === "known:USDC") onChange({ kind: "known", symbol: "USDC" });
      }}
    >
      <option value="known:USDC" disabled={usdcDisabled}>
        USDC
      </option>
      <option value="native" disabled={nativeDisabled}>
        XLM (native)
      </option>
    </select>,
  );
}

export function AssetField({
  asset,
  onChange,
  expectedAsset,
  error,
}: {
  asset: SimpleAsset;
  onChange: (a: SimpleAsset) => void;
  expectedAsset?: Asset | null;
  /** The node's `config.asset` issue: `fieldErrorUnder(nodeIssues(…).field, "asset")`. */
  error?: string | null;
}) {
  return (
    <AssetSelectOrReadout
      label="Asset"
      asset={asset}
      onChange={onChange}
      expectedAsset={expectedAsset}
      error={error}
    />
  );
}
