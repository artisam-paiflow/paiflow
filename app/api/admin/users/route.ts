import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { CreateAnalyticsAccountSchema } from "@/lib/analytics/account-schema";
import { db } from "@/lib/db";
import { hashPassword, requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { audit } from "@/lib/audit";
import { pwnedCount } from "@/lib/hibp";

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const q = new URL(req.url).searchParams.get("q") ?? undefined;
    const items = await db.user.findMany({
      where: q ? { username: { contains: q, mode: "insensitive" } } : undefined,
      select: {
        id: true,
        username: true,
        role: true,
        analyticsAudience: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        lockedUntil: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ data: items });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const admin = await requireSession({ role: Role.ADMIN });
    await enforceWriteRateLimit("adminWrite", admin.id);
    const body = CreateAnalyticsAccountSchema.parse(await req.json());
    if (body.password.toLowerCase().includes(body.username.toLowerCase())) {
      throw new AppError("VALIDATION", "Password must not contain the username");
    }
    const pwned = await pwnedCount(body.password);
    if (pwned !== null && pwned > 0) {
      throw new AppError("VALIDATION", "Password appears in known breaches");
    }
    const exists = await db.user.findUnique({ where: { username: body.username } });
    if (exists) throw new AppError("CONFLICT", "Username already taken");
    const u = await db.user.create({
      data: {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        analyticsAudience: body.analyticsAudience,
      },
      select: { id: true, username: true, role: true, analyticsAudience: true },
    });
    await audit({
      action: "ADMIN_USER_CREATE",
      userId: admin.id,
      metadata: { newUserId: u.id, role: u.role, analyticsAudience: u.analyticsAudience },
    });
    return NextResponse.json({ data: u }, { status: 201 });
  });
}
