import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireSession, verifyPassword } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { pwnedCount } from "@/lib/hibp";

const ChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceRateLimit({
      key: `pwchange:${user.id}`,
      limit: 5,
      windowSeconds: 60 * 10,
      message: "Too many password change attempts",
    });

    const body = ChangeSchema.parse(await req.json());
    if (body.newPassword === body.currentPassword) {
      throw new AppError("VALIDATION", "New password must differ from current");
    }
    if (body.newPassword.toLowerCase().includes(user.username.toLowerCase())) {
      throw new AppError("VALIDATION", "Password must not contain the username");
    }
    const pwned = await pwnedCount(body.newPassword);
    if (pwned !== null && pwned > 0) {
      throw new AppError("VALIDATION", "This password appears in known breaches");
    }

    const row = await db.user.findUnique({ where: { id: user.id } });
    if (!row) throw new AppError("NOT_FOUND", "User not found");
    const ok = await verifyPassword(row.passwordHash, body.currentPassword);
    if (!ok) throw new AppError("FORBIDDEN", "Current password is incorrect");

    const newHash = await hashPassword(body.newPassword);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    // Rotate sessions on privilege/credential change.
    await db.session.deleteMany({ where: { userId: user.id } });
    await audit({
      action: "USER_PASSWORD_CHANGE",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ data: { ok: true } });
  });
}
