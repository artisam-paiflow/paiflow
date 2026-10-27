"use client";

import { Field } from "./field";
import { inputClass, suffixClass } from "./styles";

type Props = {
  label: React.ReactNode;
  value: number | undefined;
  onChange: (percentage: number | undefined) => void;
  error?: string | null;
};

/** Pay stores a percentage, rather than bps. Keep its precision and clear-to-unset behavior. */
export function PercentageInput({ label, value, onChange, error }: Props) {
  return (
    <Field label={label} error={error}>
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            {...control}
            className={inputClass}
            type="number"
            min={0}
            max={100}
            value={value ?? ""}
            onChange={(e) => {
              const next = Number(e.target.value);
              onChange(
                e.target.value === "" || isNaN(next) ? undefined : Math.min(100, Math.max(0, next)),
              );
            }}
          />
          <span aria-hidden className={suffixClass}>
            %
          </span>
        </div>
      )}
    </Field>
  );
}
