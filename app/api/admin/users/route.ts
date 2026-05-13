import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { Role } from "@prisma/client";
import { pwnedCount } from "@/lib/hibp";

const CreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(12).max(256),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

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
    const body = CreateSchema.parse(await req.json());
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
      },
      select: { id: true, username: true, role: true },
    });
    await audit({
      action: "ADMIN_USER_CREATE",
      userId: admin.id,
      metadata: { newUserId: u.id, role: u.role },
    });
    return NextResponse.json({ data: u }, { status: 201 });
  });
}
