/**
 * Where the browser goes after a successful sign-in, from the `?from=` param
 * middleware set when it bounced an unauthenticated visitor (middleware.ts).
 *
 * That param is the only thing a caller supplies that steers a post-login
 * navigation, so a crafted `/login?from=…` is a phishing primitive on an app
 * whose users sign wallet transactions — land them on a look-alike host with a
 * live session and the page can ask for anything. `from.startsWith("/")`, which
 * both call sites used before #515, is not the check: a browser reads
 * "//evil.com" and "/\evil.com" as absolute, and the URL parser strips TAB/LF/CR
 * before parsing, so "/\t/evil.com" passes any test of the character after the
 * leading slash and still resolves off-host.
 *
 * So resolve it and compare origins — the parser has already normalised every
 * one of those shapes by then. A path is the right return here, unlike
 * `callbacks.redirect` in auth.config.ts, which must hand next-auth something
 * `new URL()` can parse: `window.location.href` resolves a path against the
 * origin the visitor is actually on, and this value never reaches next-auth.
 *
 * No `server-only` — the two callers are client components.
 */
export function safeReturnPath(
  from: string | undefined,
  origin: string,
  fallback = "/dashboard",
): string {
  try {
    const target = new URL(from || fallback, origin);
    return target.origin === origin ? target.pathname + target.search + target.hash : fallback;
  } catch {
    return fallback;
  }
}
