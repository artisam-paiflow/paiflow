import "server-only";
import crypto from "node:crypto";

export function hashApiToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
/** Activity is approximate; authentication still checks the database every time. */
export function tokenUsageStamp(lastUsedAt: Date | null) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 5 * 60000);
  return lastUsedAt && lastUsedAt > cutoff ? null : { now, cutoff };
}
