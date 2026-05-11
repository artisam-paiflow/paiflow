import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const RegisterSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Username may only contain letters, numbers, _, ., -"),
  password: z.string().min(12).max(256),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    if (!env().ALLOW_PUBLIC_REGISTRATION) {
      throw new AppError("FORBIDDEN", "Public registration is disabled");
    }
    const ip = clientIp(req);
    const rl = await rateLimit(`register:${ip}`, 5, 60 * 10);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many registration attempts");

    const body = RegisterSchema.parse(await req.json());
    if (body.password.toLowerCase().includes(body.username.toLowerCase())) {
      throw new AppError("VALIDATION", "Password must not contain the username");
    }

    const existing = await db.user.findUnique({ where: { username: body.username } });
    if (existing) throw new AppError("CONFLICT", "Username already taken");

    const passwordHash = await hashPassword(body.password);
    const user = await db.user.create({
      data: { username: body.username, passwordHash },
      select: { id: true, username: true },
    });
    await audit({
      action: "USER_REGISTER",
      userId: user.id,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ data: user }, { status: 201 });
  });
}
