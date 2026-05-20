import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { generateResetToken, hashResetToken, resetTokenExpiresAt } from "@/lib/auth/password-reset";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

// Generic response body used for every public-facing outcome so we don't leak
// whether the email is registered. Front-end mirrors this message verbatim.
const GENERIC_OK = {
  data: {
    message:
      "If an account exists for that email, a reset link is on its way. Check your inbox in a minute.",
  },
};

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const ip = clientIp(req);
    const body = Body.parse(await req.json());

    // Two-layer rate limit: per-IP catches shotgun abuse, per-email caps
    // targeted attempts at a single account.
    const ipBucket = await rateLimit(`pwreset:ip:${ip}`, 10, 60 * 60);
    if (!ipBucket.ok) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many reset requests from this network. Try again in an hour.",
      );
    }
    const emailBucket = await rateLimit(`pwreset:email:${body.email}`, 5, 60 * 60);
    if (!emailBucket.ok) {
      // Still return the generic response — don't let an attacker discover the
      // rate-limit boundary on a specific email.
      log.warn({ email: body.email }, "password-reset: per-email rate limit hit");
      return NextResponse.json(GENERIC_OK);
    }

    const user = await db.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, username: true, isActive: true },
    });

    // Always return the same response shape regardless of whether the email
    // belongs to a known account. Only do real work when it does.
    if (!user || !user.email || !user.isActive) {
      log.info(
        { ip, email: body.email, found: Boolean(user) },
        "password-reset: request for unknown/inactive email — returning generic ok",
      );
      return NextResponse.json(GENERIC_OK);
    }

    const rawToken = generateResetToken();
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = resetTokenExpiresAt();

    // A fresh request supersedes any outstanding links. Invalidate them in
    // the same transaction as the new token so the user never has more than
    // one usable reset link at a time.
    await db.$transaction([
      db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    const resetLink = `${env().NEXT_PUBLIC_APP_URL}/auth/new-password?token=${rawToken}`;

    const result = await sendPasswordResetEmail({
      to: user.email,
      resetLink,
      recipientLabel: user.username,
    });

    if (!result.ok) {
      // Email transport failure: drop the token we just persisted so it can't
      // be used (defensive — without the email the user has no way to read
      // the raw token anyway, but we don't want stale rows piling up).
      await db.passwordResetToken
        .deleteMany({ where: { userId: user.id, tokenHash } })
        .catch(() => {});
      throw new AppError(
        "UPSTREAM_RPC",
        "Couldn't send the reset email right now. Please try again shortly.",
      );
    }

    await audit({
      action: "USER_PASSWORD_RESET_REQUEST",
      userId: user.id,
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
      metadata: { email: user.email },
    });

    return NextResponse.json(GENERIC_OK);
  });
}
