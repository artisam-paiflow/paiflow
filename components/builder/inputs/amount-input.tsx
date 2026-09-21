"use client";

import { I128_MAX } from "@/lib/flows/primitives";
import { assetLabel, type Asset } from "@/lib/flows/schema";
import { Field } from "./field";
import { formatUnits, STROOP_DECIMALS } from "./numeric.utils";
import { inputClass, suffixClass } from "./styles";
import { useDraftNumber } from "./use-draft-number";

type Props = {
  label: React.ReactNode;
  /** Stroops, or `""` when no amount is set. */
  value: string;
  onChange: (stroops: string) => void;
  /** Supplies the unit suffix and the `= 1.5 USDC` echo. */
  asset?: Asset;
  /** Stroops. */
  min?: string;
  /** Stroops; defaults to the largest i128 a contract call can encode. */
  max?: string;
  decimals?: number;
  error?: string | null;
  hint?: React.ReactNode;
  disabled?: boolean;
};

const STROOPS = /^\d{1,39}$/;

function toUnits(stroops: string | undefined): bigint | null {
  return stroops !== undefined && STROOPS.test(stroops) ? BigInt(stroops) : null;
}

/** A token amount typed in whole units and committed as a stroops string. */
export function AmountInput({
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
}: Props) {
  const unit = asset ? assetLabel(asset) : null;
  const describe = (units: bigint) =>
    [formatUnits(units, decimals), unit].filter(Boolean).join(" ");
  const current = toUnits(value);
  const { note, inputProps } = useDraftNumber({
    value: current,
    onChange: (units) => onChange(units.toString()),
    decimals,
    min: toUnits(min) ?? 0n,
    max: toUnits(max) ?? I128_MAX,
    describe,
  });
  // The echo is what the flow holds, which the draft may not show mid-edit.
  const echo = current !== null && unit ? `= ${describe(current)}` : null;

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
          <input {...control} {...inputProps} className={inputClass} disabled={disabled} />
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
