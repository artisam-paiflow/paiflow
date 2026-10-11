import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleSignupIntent,
  signupHash,
  GOOGLE_SIGNUP_COOKIE,
  GOOGLE_SIGNUP_INTENT_MS,
} from "@/lib/auth/google-signup";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const ATTEMPT_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-paiflow.google-code-attempt"
    : "paiflow.google-code-attempt";
export async function POST(req: NextRequest) {
  const previous = req.cookies.get(ATTEMPT_COOKIE)?.value;
  const browser =
    previous && /^[a-f0-9]{64}$/.test(previous) ? previous : randomBytes(32).toString("hex");
  const response = await withErrorHandler(async () => {
    if (req.headers.get("origin") !== new URL(env().AUTH_URL).origin)
      throw new AppError("FORBIDDEN", "Use the configured signup page to enter your code.");
    // A venue can share one IP. Tight browser budgets and a looser IP backstop
    // bound guessing without blocking an entire hackathon after a few signups.
    await enforceRateLimit({
      key: `google-signup-code-ip:${clientIp(req)}`,
      limit: 600,
      windowSeconds: 600,
      message: "Too many code attempts. Try again in ten minutes.",
    });
    await enforceRateLimit({
      key: `google-signup-code-browser:${signupHash(browser)}`,
      limit: 10,
      windowSeconds: 600,
      message: "Too many code attempts. Try again in ten minutes.",
    });
    let input: unknown;
    try {
      input = await req.json();
    } catch {
      throw new AppError("VALIDATION", "Enter a valid access code to continue.");
    }
    const token = await createGoogleSignupIntent(
      input,
      req.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value,
    );
    const result = NextResponse.json({ data: { ok: true } });
    result.cookies.set(GOOGLE_SIGNUP_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: GOOGLE_SIGNUP_INTENT_MS / 1000,
    });
    return result;
  });
  // Persist the browser budget even on invalid codes or throttled requests.
  response.cookies.set(ATTEMPT_COOKIE, browser, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
  if (response.status !== 200)
    response.cookies.set(GOOGLE_SIGNUP_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
