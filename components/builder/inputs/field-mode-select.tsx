"use client";

import type { FieldMode } from "@/lib/flows/field-policies";
import { Field } from "./field";
import { inputClass } from "./styles";

/** Stored updates are deliberately not offered before that capability ships. */
export function FieldModeSelect({
  label,
  value,
  onChange,
  executionIssue,
  constantLabel = "Constant",
  executionLabel = "Payer supplies each payment",
}: {
  label: string;
  value: FieldMode;
  onChange: (mode: "constant" | "execution") => void;
  executionIssue?: string;
  constantLabel?: string;
  executionLabel?: string;
}) {
  return (
    <Field
      label={label}
      hint={executionIssue}
      error={
        value === "mutable"
          ? "This stored-update mode is not available. Choose a supported mode before deploying."
          : undefined
      }
    >
      {(control) => (
        <select
          {...control}
          className={inputClass}
          value={value === "mutable" ? "" : value}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "constant" || (mode === "execution" && !executionIssue)) onChange(mode);
          }}
        >
          {value === "mutable" && (
            <option value="" disabled>
              Unsupported mode in this draft
            </option>
          )}
          <option value="constant">{constantLabel}</option>
          <option value="execution" disabled={Boolean(executionIssue)}>
            {executionLabel}
          </option>
        </select>
      )}
    </Field>
  );
}
