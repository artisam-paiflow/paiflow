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
