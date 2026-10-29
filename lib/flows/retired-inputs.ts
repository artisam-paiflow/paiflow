/** Detect retired financial instructions before schemas strip unknown fields.
 * Iteration also handles deeply nested or cyclic non-JSON callers safely. */
export function hasRetiredPayoutInput(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== "object" || seen.has(next)) continue;
    seen.add(next);
    if (Array.isArray(next)) {
      for (const item of next) pending.push(item);
      continue;
    }
    const record = next as Record<string, unknown>;
    if (
      record.type === "cash_out" ||
      record.kind === "cash_out" ||
      record.type === "cash_out_dev" ||
      record.kind === "cash_out_dev" ||
      record.templateKind === "CASH_OUT_DEV" ||
      record.templateKind === "CASH_OUT" ||
      record.isCashOut === true ||
      record.is_cash_out === true ||
      record.payoutMode === "fiat" ||
      record.payoutMode === "FIAT"
    )
      return true;
    for (const key of ["senderKyc", "bankDetail", "bankCode", "accountNumber", "accountName"]) {
      if (record[key] !== undefined) return true;
    }
    for (const [key, item] of Object.entries(record)) {
      if (key === "positions" && Array.isArray(record.nodes) && Array.isArray(record.edges)) {
        // Dictionary keys are node IDs, but coordinate values are still input.
        // Validate their shape and scan values instead of exempting the subtree.
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        for (const coordinate of Object.values(item)) {
          if (!coordinate || typeof coordinate !== "object" || Array.isArray(coordinate))
            return true;
          const point = coordinate as Record<string, unknown>;
          if (
            typeof point.x !== "number" ||
            !Number.isFinite(point.x) ||
            typeof point.y !== "number" ||
            !Number.isFinite(point.y)
          )
            return true;
          pending.push(coordinate);
        }
        continue;
      }
      pending.push(item);
    }
  }
  return false;
}
