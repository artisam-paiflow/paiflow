import "server-only";
import crypto from "node:crypto";

/**
 * The stored form of a machine API token. Shared by `requireDevApiToken`
 * (`lib/auth.ts`) and `requireDeploymentToken` (`lib/api/v1/auth.ts`) so the two
 * lookups never drift. Kept out of `lib/auth.ts` so it can be imported without
 * loading next-auth.
 */
export function hashApiToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Activity is approximate; authentication still checks the database every time. */
export function tokenUsageStamp(lastUsedAt: Date | null) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 5 * 60_000);
  return lastUsedAt && lastUsedAt > cutoff ? null : { now, cutoff };
}
