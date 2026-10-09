import { NextRequest, NextResponse } from "next/server";
import { auth, requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  GoogleLinkSchema,
  createGoogleLinkIntent,
  GoogleAuthError,
  GOOGLE_LINK_COOKIE,
  GOOGLE_RECENT_AUTH_MS,
} from "@/lib/auth/google";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    if (user.role === "SANDBOX")
      throw new AppError("FORBIDDEN", "Google linking is unavailable in the sandbox");
    // Protect the explicit consent mutation from cross-site form requests.
    if (req.headers.get("origin") !== new URL(env().AUTH_URL).origin)
      throw new AppError("FORBIDDEN", "Use the configured sign-in origin to link Google");
    await enforceRateLimit({ key: `google-link:${user.id}`, limit: 5, windowSeconds: 600 });
    GoogleLinkSchema.parse(await req.json());
    const session = await auth();
    const claims = session?.user as
      | { sessionVersion?: number; authenticatedAt?: unknown }
      | undefined;
    if (typeof claims?.sessionVersion !== "number")
      throw new AppError("UNAUTHENTICATED", "Sign in again before linking Google");
    try {
      const token = await createGoogleLinkIntent({
        id: user.id,
        sessionVersion: claims.sessionVersion,
        authenticatedAt: claims.authenticatedAt,
      });
      const response = NextResponse.json({ data: { ok: true } });
      response.cookies.set(GOOGLE_LINK_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: GOOGLE_RECENT_AUTH_MS / 1000,
      });
      return response;
    } catch (error) {
      if (error instanceof GoogleAuthError)
        throw new AppError(
          "FORBIDDEN",
          error.reason === "link-expired"
            ? "Sign out and sign in again, then link Google within five minutes."
            : "Google linking is unavailable for this account.",
        );
      throw error;
    }
  });
}
