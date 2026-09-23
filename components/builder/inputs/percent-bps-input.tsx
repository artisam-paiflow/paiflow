"use client";

import { TOTAL_BPS } from "@/lib/flows/schema";
import { Field } from "./field";
import { formatUnits } from "./numeric.utils";
import { inputClass, suffixClass } from "./styles";
import { useDraftNumber } from "./use-draft-number";

// Percent with two decimals, read as fixed-point, *is* basis points: "12.5"
// parses to 1250 units. No float on the way in or out, so neither
// `pctToBps`'s Math.round nor an inline `* 100` is needed.
const PERCENT_DECIMALS = 2;

export function formatPercent(bps: number | bigint): string {
  return `${formatUnits(BigInt(bps), PERCENT_DECIMALS)}%`;
}

export type PercentBpsInputProps = {
  label: React.ReactNode;
  /** Integer basis points. */
  value: number;
  onChange: (bps: number) => void;
  minBps?: number;
  maxBps?: number;
  error?: string | null;
  hint?: React.ReactNode;
  disabled?: boolean;
};

/**
 * The core `ShareInput` wraps: a percentage shown to two decimals and
 * committed as integer bps. Internal — panels use `ShareInput`.
 */
export function PercentBpsInput({
  label,
  value,
  onChange,
  minBps = 0,
  maxBps = TOTAL_BPS,
  error,
  hint,
  disabled,
}: PercentBpsInputProps) {
  const { note, inputProps } = useDraftNumber({
    value: Number.isSafeInteger(value) ? BigInt(value) : null,
    // Safe: the hook only commits within [minBps, maxBps], at most TOTAL_BPS.
    onChange: (units) => onChange(Number(units)),
    decimals: PERCENT_DECIMALS,
    min: BigInt(minBps),
    max: BigInt(maxBps),
    describe: formatPercent,
  });

  return (
    <Field label={label} hint={hint} note={note} error={error}>
      {(control) => (
        <div className="flex items-center gap-2">
          <input {...control} {...inputProps} className={inputClass} disabled={disabled} />
          <span aria-hidden className={suffixClass}>
            %
          </span>
        </div>
      )}
    </Field>
  );
}
