"use client";
import type { CreationValue } from "@/lib/flows/field-policies";
import { inputClass } from "@/components/builder/inputs/styles";
export default function ValueInput({
  type,
  value,
  onChange,
  label,
  disabled = false,
}: {
  type: CreationValue["type"];
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      {type === "boolean" ? (
        <select
          className={inputClass}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a value</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : (
        <input
          className={inputClass}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode={["stroops", "integer", "bps"].includes(type) ? "numeric" : undefined}
          placeholder={
            type === "timestamp"
              ? "2026-12-01T00:00:00Z"
              : type === "stroops"
                ? "Integer stroops (1 XLM = 10000000)"
                : type
          }
        />
      )}
    </label>
  );
}
