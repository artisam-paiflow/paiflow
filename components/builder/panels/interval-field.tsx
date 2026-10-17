"use client";

import { inputClass } from "../inputs/styles";
import { Field } from "../inputs/field";

type IntervalUnit = "minute" | "hour" | "day" | "week" | "month";

/** Each part has its own name and validation message within the interval group. */
export function IntervalField({
  shared = false,
  amount,
  unit,
  amountError,
  unitError,
  onAmountChange,
  onUnitChange,
}: {
  /** Use shared styling in migrated forms; Payroll retains its existing presentation. */
  shared?: boolean;
  amount: number;
  unit: IntervalUnit;
  amountError?: string | null;
  unitError?: string | null;
  onAmountChange: (amount: number) => void;
  onUnitChange: (unit: IntervalUnit) => void;
}) {
  return (
    <Field label="Interval" group>
      <div className="grid grid-cols-[5rem_1fr] items-start gap-2">
        <Field label="Number" error={amountError}>
          {(control) => (
            <input
              {...control}
              className={shared ? inputClass : "input text-right"}
              type="number"
              min={1}
              value={amount}
              onChange={(e) => onAmountChange(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          )}
        </Field>
        <Field label="Unit" error={unitError}>
          {(control) => (
            <select
              {...control}
              className={shared ? inputClass : "input"}
              value={unit}
              onChange={(e) => onUnitChange(e.target.value as IntervalUnit)}
            >
              <option value="minute">Minute(s)</option>
              <option value="hour">Hour(s)</option>
              <option value="day">Day(s)</option>
              <option value="week">Week(s)</option>
              <option value="month">Month(s)</option>
            </select>
          )}
        </Field>
      </div>
    </Field>
  );
}
