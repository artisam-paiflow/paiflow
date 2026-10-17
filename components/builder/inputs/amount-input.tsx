"use client";

import { I128_MAX } from "@/lib/flows/primitives";
import { assetLabel, type Asset } from "@/lib/flows/schema";
import { Field } from "./field";
import { formatUnits, STROOP_DECIMALS } from "./numeric.utils";
import { inputClass, suffixClass } from "./styles";
import { useDraftNumber } from "./use-draft-number";
import { useStroopsDraft } from "./use-stroops-draft";

type Props = {
  label: React.ReactNode;
  /** Stroops, or `""` when no amount is set. */
  value: string | undefined;
  placeholder?: string;
  onChange: (stroops: string) => void;
  /** Supplies the unit suffix and the `= 1.5 USDC` echo. */
  asset?: Asset;
  error?: string | null;
  hint?: React.ReactNode;
  disabled?: boolean;
  /** Shows the `= 1.5 USDC` echo under the field; off where the unit suffix already says it. */
  echo?: boolean;
} & (
  | {
      commit?: "valid";
      /** Stroops; defaults to 1 stroop. */
      min?: string;
      /** Stroops; defaults to the largest i128. */
      max?: string;
      decimals?: number;
      emptyNote?: (described: string) => string;
    }
  | {
      /** Preserve immediate zero-on-clear commits and leave bounds to node validation. */
      commit: "draft";
      min?: never;
      max?: never;
      decimals?: never;
      emptyNote?: never;
    }
);

const STROOPS = /^\d{1,39}$/;

function toUnits(stroops: string | undefined): bigint | null {
  return stroops !== undefined && STROOPS.test(stroops) ? BigInt(stroops) : null;
}

/** A token amount typed in whole units and committed as a stroops string. */
export function AmountInput(props: Props) {
  return props.commit === "draft" ? (
    <DraftAmountInput {...props} />
  ) : (
    <BoundedAmountInput {...props} />
  );
}

function BoundedAmountInput({
  label,
  value,
  onChange,
  asset,
  min,
  max,
  decimals = STROOP_DECIMALS,
  error,
  hint,
  disabled,
  emptyNote,
  echo: showEcho = true,
  placeholder,
}: Props) {
  const unit = asset ? assetLabel(asset) : null;
  const describe = (units: bigint) =>
    [formatUnits(units, decimals), unit].filter(Boolean).join(" ");
  const current = toUnits(value);
  const { note, inputProps } = useDraftNumber({
    value: current,
    onChange: (units) => onChange(units.toString()),
    decimals,
    min: toUnits(min) ?? 1n,
    max: toUnits(max) ?? I128_MAX,
    describe,
    emptyNote,
  });
  // The echo is what the flow holds, which the draft may not show mid-edit.
  const echo = showEcho && current !== null && unit ? `= ${describe(current)}` : null;

  return (
    <Field
      label={label}
      hint={
        hint || echo ? (
          <>
            {hint}
            {hint && echo ? " " : null}
            {echo}
          </>
        ) : undefined
      }
      note={note}
      error={error}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            {...control}
            {...inputProps}
            className={inputClass}
            disabled={disabled}
            placeholder={placeholder}
          />
          {unit && (
            <span aria-hidden className={suffixClass}>
              {unit}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}

/** Uses the same field presentation while retaining the existing nodes' editing contract. */
function DraftAmountInput({
  label,
  value,
  onChange,
  asset,
  error,
  hint,
  disabled,
  placeholder,
  echo: showEcho = true,
}: Props) {
  const { inputProps, note } = useStroopsDraft(value, onChange);
  const unit = asset ? assetLabel(asset) : null;
  const current = toUnits(value);
  const echo =
    showEcho && current !== null && unit
      ? `= ${formatUnits(current, STROOP_DECIMALS)} ${unit}`
      : null;
  return (
    <Field
      label={label}
      hint={
        hint || echo ? (
          <>
            {hint}
            {hint && echo ? " " : null}
            {echo}
          </>
        ) : undefined
      }
      note={note}
      error={error}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            {...control}
            {...inputProps}
            className={inputClass}
            disabled={disabled}
            placeholder={placeholder}
          />
          {unit && (
            <span aria-hidden className={suffixClass}>
              {unit}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}
