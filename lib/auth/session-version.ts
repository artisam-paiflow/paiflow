import "server-only";

/**
 * Decides whether a session token still stands for its user.
 *
 * Sessions are stateless JWTs with a 7-day life: there is no row to delete, so
 * a token is ended by making it stop matching. `User.sessionVersion` is copied
 * into the token at login (`auth.config.ts`), and deactivating the account,
 * changing or resetting its password, changing its role or "revoke all
 * sessions" increments the column.
 *
 * Lives outside `lib/auth.ts` because that module cannot be imported under
 * vitest (next-auth fails to resolve `next/server` there), and this is the rule
 * that most needs a test.
 */
export type SessionVersionRow = { isActive: boolean; sessionVersion: number };

export function isSessionCurrent(
  token: { sessionVersion?: unknown },
  row: SessionVersionRow | null,
): boolean {
  if (!row || !row.isActive) return false;
  // Tokens minted before the column existed carry no version. The column
  // defaults to 0, so reading "absent" as 0 lets those sessions survive the
  // deploy and still end at the first bump.
  const tokenVersion = token.sessionVersion ?? 0;
  return tokenVersion === row.sessionVersion;
}
