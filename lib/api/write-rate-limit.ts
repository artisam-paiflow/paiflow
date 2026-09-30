import "server-only";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Limits for the session- and token-authed mutating routes that had none (#371).
 * One table so a new route picks a row rather than inventing a number.
 *
 * Each limit is per window per subject. The subject is the signed-in user (or the
 * user a machine token maps to), never the address: ten hackathon teams share one
 * venue IP, and a per-address bucket would lock them out of each other. The two
 * `ip` rows are for callers with no identity yet (passkey login) and are sized for
 * a whole room signing in at once.
 *
 * The numbers are ceilings for abuse, well above what a person clicking fast
 * reaches. Builder autosave and validate are the chattiest human-driven callers.
 */
export const WRITE_RATE_LIMITS = {
  // ---- session-authed, keyed on user ----
  addressBookWrite: { limit: 60, windowSeconds: 60 },
  passkeyManage: { limit: 20, windowSeconds: 60 },
  revokeAllSessions: { limit: 5, windowSeconds: 60 },
  adminWrite: { limit: 60, windowSeconds: 60 },
  deploymentPatch: { limit: 60, windowSeconds: 60 },
  // `deployments/prepare` is 10/min; a submit follows each prepare, with headroom for retries.
  deploymentSubmit: { limit: 30, windowSeconds: 60 },
  flowMutate: { limit: 120, windowSeconds: 60 },
  flowValidate: { limit: 120, windowSeconds: 60 },
  fileDelete: { limit: 60, windowSeconds: 60 },
  payrollWrite: { limit: 60, windowSeconds: 60 },
  // The deployment page polls this every 2 s (30/min per tab); 90 covers three tabs.
  deploymentStatus: { limit: 90, windowSeconds: 60 },
  // ---- no identity yet, keyed on address ----
  passkeyLoginOptions: { limit: 120, windowSeconds: 60 },
  passkeyLoginVerify: { limit: 120, windowSeconds: 60 },
} as const;

export type WriteRateLimitName = keyof typeof WRITE_RATE_LIMITS;

/**
 * Count one request against `name` for `subject` and throw `RATE_LIMITED` (429 via
 * `withErrorHandler`) past the limit. `subject` is a user id, `user:deployment`, or
 * for the two pre-auth rows an address; it is part of the Redis key, so keep it to
 * ids and normalised addresses.
 */
export async function enforceWriteRateLimit(
  name: WriteRateLimitName,
  subject: string,
): Promise<void> {
  const { limit, windowSeconds } = WRITE_RATE_LIMITS[name];
  await enforceRateLimit({ key: `write:${name}:${subject}`, limit, windowSeconds });
}
