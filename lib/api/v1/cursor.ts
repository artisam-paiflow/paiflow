/**
 * Opaque two-part cursor: base64url(`${head}|${tail}`). The split is on the first `|`, so `head`
 * must never contain one (a ledger number or an ISO timestamp never does); `tail` may.
 */
export function encodeCursor(head: string, tail: string): string {
  return Buffer.from(`${head}|${tail}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { head: string; tail: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep <= 0 || sep === raw.length - 1) return null;
    return { head: raw.slice(0, sep), tail: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}
