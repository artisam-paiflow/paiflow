import "server-only";
import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison, for secrets presented in a request header.
 *
 * `crypto.timingSafeEqual` needs two buffers of the same length, and padding
 * the shorter input up to the longer one makes the allocation and copy work
 * depend on where the presented length sits relative to the secret's. Hashing
 * both sides first gives it fixed-size inputs, so no step of the comparison
 * varies with either length. The digests are compared, not the strings, which
 * is fine here: a collision would need a second preimage of a random secret.
 *
 * Lives outside `lib/auth.ts` so the cron and webhook routes can import it
 * without loading next-auth — the same reason `lib/auth/api-token.ts` does.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aDigest = createHash("sha256").update(a, "utf8").digest();
  const bDigest = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(aDigest, bDigest);
}
