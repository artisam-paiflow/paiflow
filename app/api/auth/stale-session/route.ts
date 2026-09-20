import { getSessionUser, signOut } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";

// A path, not an absolute URL: behind Railway's proxy the origin this handler
// sees is the container's own address (see the redirect callback in
// auth.config.ts), and the browser resolves a relative Location against the
// host the visitor is actually on. `no-store` because a cached copy of this
// redirect would skip the sign-out, which is the loop this route exists to end.
function redirectTo(path: string): Response {
  return new Response(null, {
    status: 307,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

/**
 * Where requirePageSession() sends a cookie that still verifies as a JWT but
 * that getSessionUser() no longer accepts. Middleware only checks the
 * signature, so it treats that visitor as signed in and bounces them off
 * /login; a server component cannot clear the cookie itself. The cookie has to
 * go before the redirect, or /login sends them to /dashboard and round again.
 *
 * It is a GET because it is reached by redirect, so it must not be a way to
 * sign someone else out with a link: a session that is still good is left
 * alone.
 */
export async function GET() {
  return withErrorHandler(async () => {
    if (await getSessionUser()) return redirectTo("/dashboard");
    await signOut({ redirect: false });
    return redirectTo("/login?reason=session-ended");
  });
}
