import "server-only";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { timingSafeEqualString } from "./timing-safe";

/** One line per process, so a hammered endpoint cannot flood the log. */
let misconfigLogged = false;

/**
 * Guard for every `/api/cron/*` route. `middleware.ts` lists `/api/cron` in
 * PUBLIC_PATHS, so this is the only thing standing between the internet and
 * jobs that sign with `STELLAR_RELAYER_SECRET_KEY`.
 *
 * The policy lives here rather than in `lib/env.ts` deliberately: making
 * CRON_SECRET a required variable would refuse to boot a deployed service whose
 * value happens to be too short, and the failure mode we want is "cron refuses
 * and logs", never "site down".
 *
 * Lives outside `lib/auth.ts` (which re-exports it) because that module builds
 * NextAuth at import time; cron routes should not carry next-auth.
 */
export function requireCronSecret(req: NextRequest): void {
  const { CRON_SECRET: secret, NODE_ENV } = env();

  // Fail closed off a developer machine. An unset secret must never mean "open
  // to anyone who finds the URL", and a short one is guessable.
  if (NODE_ENV === "production" && (!secret || secret.length < 32)) {
    if (!misconfigLogged) {
      misconfigLogged = true;
      // `present` separates "unset" from "too short" without logging the value
      // or its length.
      log.error(
        { present: Boolean(secret) },
        "CRON_SECRET is unset or shorter than 32 chars; /api/cron/* is refusing every request",
      );
    }
    throw new AppError("FORBIDDEN", "Bad cron secret");
  }

  // Development and test only: production returned above.
  if (!secret) return;

  const presented = req.headers.get("x-cron-secret");
  if (!presented || !timingSafeEqualString(presented, secret)) {
    throw new AppError("FORBIDDEN", "Bad cron secret");
  }
}
