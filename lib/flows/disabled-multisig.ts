/** Multisig remains readable/compilable for historical evidence, but new use is
 * disabled until its constructor and forwarding protocol are fixed (#1167). */
export const MULTISIG_DISABLED_MESSAGE =
  "Multisig is unavailable for new deployments and template instances.";

/** Inspect original snapshots too: a graph that no longer parses must not hide
 * a Multisig instruction in its compiled parameters or pipeline kinds. */
export function hasDisabledMultisigInput(value: unknown): boolean {
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
    if (record.kind === "multisig" || record.templateKind === "MULTISIG") return true;
    for (const child of Object.values(record)) pending.push(child);
  }
  return false;
}
