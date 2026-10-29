/** Retired financial instructions must be refused before unknown fields are stripped.
 * Labels, names and dictionary keys are not instructions. Iteration also handles
 * cyclic and deeply nested caller objects without recursion. */
export function hasRetiredPayrollInput(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      record.type === "payroll" ||
      record.type === "payroll_dev" ||
      record.kind === "payroll" ||
      record.kind === "payroll_dev" ||
      record.kind === "payroll_trigger" ||
      record.kind === "payroll_trigger_dev" ||
      record.templateKind === "PAYROLL" ||
      record.templateKind === "PAYROLL_DEV"
    )
      return true;
    for (const child of Object.values(record)) pending.push(child);
  }
  return false;
}
export const PAYROLL_RETIRED_MESSAGE = "Payroll has been retired.";
