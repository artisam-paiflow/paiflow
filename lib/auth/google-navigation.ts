import { safeReturnPath } from "@/lib/safe-return-path";

/** Move to the configured OAuth cookie domain before creating state/PKCE
 * cookies. Return paths stay relative and are checked against the current host. */
export function googleStartUrl(
  authOrigin: string | undefined,
  currentOrigin: string,
  link: boolean,
  from?: string,
  signup = false,
): string | null {
  if (!authOrigin || currentOrigin === authOrigin) return null;
  const target = new URL(link ? "/account" : signup ? "/register" : "/login", authOrigin);
  if (signup) target.searchParams.set("googleSignup", "1");
  if (!link) target.searchParams.set("from", safeReturnPath(from, currentOrigin));
  return target.toString();
}
