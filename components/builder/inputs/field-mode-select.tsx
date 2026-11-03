"use client";

import type { FieldMode } from "@/lib/flows/field-policies";
import { Field } from "./field";
import { inputClass } from "./styles";

/** Draft declarations only. A deployment's modes never change through this control. */
export function FieldModeSelect({
  label,
  value,
  onChange,
  executionIssue,
  constantLabel = "Constant",
  executionLabel = "Payer supplies each payment",
  allowMutable = false,
  allowExecution = true,
  mutableLabel = "Admin can update stored value",
  mutableIssue,
}: {
  label: string;
  value: FieldMode;
  onChange: (mode: FieldMode) => void;
  executionIssue?: string;
  constantLabel?: string;
  executionLabel?: string;
  allowMutable?: boolean;
  allowExecution?: boolean;
  mutableLabel?: string;
  mutableIssue?: string;
}) {
  return (
    <Field
      label={label}
      hint={executionIssue ?? mutableIssue}
      error={
        value === "mutable" && !allowMutable
          ? "This stored-update mode is not available. Choose a supported mode before deploying."
          : undefined
      }
    >
      {(control) => (
        <select
          {...control}
          className={inputClass}
          value={value === "mutable" && !allowMutable ? "" : value}
          onChange={(event) => {
            const mode = event.target.value;
            if (
              mode === "constant" ||
              (mode === "execution" && allowExecution && !executionIssue) ||
              (mode === "mutable" && allowMutable && !mutableIssue)
            )
              onChange(mode);
          }}
        >
          {value === "mutable" && !allowMutable && (
            <option value="" disabled>
              Unsupported mode in this draft
            </option>
          )}
          <option value="constant">{constantLabel}</option>
          {allowExecution && (
            <option value="execution" disabled={Boolean(executionIssue)}>
              {executionLabel}
            </option>
          )}
          {allowMutable && (
            <option value="mutable" disabled={Boolean(mutableIssue)}>
              {mutableLabel}
            </option>
          )}
        </select>
      )}
    </Field>
  );
}
