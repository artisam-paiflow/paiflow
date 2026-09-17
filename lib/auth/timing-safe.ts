import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison, for secrets presented in a request header.
 *
 * `crypto.timingSafeEqual` refuses buffers of differing length, so both sides
 * are padded to the longer one and the real length is compared separately.
 * That leaks the length of the expected secret, which is not the secret.
 *
 * Lives outside `lib/auth.ts` so the cron and webhook routes can import it
 * without loading next-auth — the same reason `lib/auth/api-token.ts` does.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // timingSafeEqual rejects zero-length buffers; the length check below still
  // decides the "" vs "" case correctly.
  const len = Math.max(aBuf.length, bBuf.length, 1);
  const aPadded = Buffer.alloc(len, 0);
  const bPadded = Buffer.alloc(len, 0);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  return timingSafeEqual(aPadded, bPadded) && aBuf.length === bBuf.length;
}
