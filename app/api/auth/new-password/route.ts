import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { hashResetToken } from "@/lib/auth/password-reset";

const Body = z.object({
  token: z.string().min(20).max(256),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(256, "Password is too long"),
});

const INVALID_TOKEN_MSG = "This reset link is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const ip = clientIp(req);

    // Per-IP bucket catches anyone brute-forcing token values.
    const ipBucket = await rateLimit(`pwreset:consume:ip:${ip}`, 20, 60 * 60);
    if (!ipBucket.ok) {
      throw new AppError("RATE_LIMITED", "Too many attempts. Try again in an hour.");
    }

    const body = Body.parse(await req.json());
    const tokenHash = hashResetToken(body.token);

    const record = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { id: true, isActive: true, username: true } },
      },
    });

    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user?.isActive) {
      throw new AppError("VALIDATION", INVALID_TOKEN_MSG);
    }

    const newHash = await hashPassword(body.password);

    // Single transaction: rotate password, mark this token used, invalidate
    // all other outstanding reset tokens for the same user, clear lockout,
    // and revoke all existing sessions so any device with a stale session
    // has to sign in again with the new password.
    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: newHash,
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
      db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      db.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
      db.session.deleteMany({ where: { userId: record.userId } }),
    ]);

    await audit({
      action: "USER_PASSWORD_RESET_COMPLETE",
      userId: record.userId,
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({
      data: { message: "Password updated. You can sign in with your new password." },
    });
  });
}
