import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { Role } from "@prisma/client";

const PatchSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  isActive: z.boolean().optional(),
  resetPassword: z.string().min(12).max(256).optional(),
  unlock: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const admin = await requireSession({ role: Role.ADMIN });
    const { id } = await ctx.params;
    const body = PatchSchema.parse(await req.json());
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new AppError("NOT_FOUND", "User not found");
    if (target.id === admin.id && body.isActive === false) {
      throw new AppError("FORBIDDEN", "Cannot deactivate yourself");
    }
    // A sandbox account is a throwaway anyone can mint. Promoting it out of the
    // role would hand it the whole app, and setting a password would replace
    // the sentinel that keeps the credentials path from ever opening it (see
    // lib/sandbox.ts). Deactivating and unlocking stay available.
    if (target.role === Role.SANDBOX && (body.role || body.resetPassword)) {
      throw new AppError("FORBIDDEN", "A sandbox account's role and password cannot be changed");
    }

    const data: {
      role?: Role;
      isActive?: boolean;
      passwordHash?: string;
      failedLogins?: number;
      lockedUntil?: Date | null;
      sessionVersion?: { increment: number };
    } = {};
    if (body.role) data.role = body.role;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (body.resetPassword) data.passwordHash = await hashPassword(body.resetPassword);
    if (body.unlock) {
      data.failedLogins = 0;
      data.lockedUntil = null;
    }
    // Sessions are JWTs, so none of the three takes effect on a signed-in user
    // until their token stops matching (lib/auth/session-version.ts). Unlock is
    // left out on purpose: it grants nothing a live session didn't already have.
    const roleChanged = body.role !== undefined && body.role !== target.role;
    if (body.isActive === false || roleChanged || body.resetPassword) {
      data.sessionVersion = { increment: 1 };
    }

    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, username: true, role: true, isActive: true },
    });
    await audit({
      action: body.isActive === false ? "ADMIN_USER_DEACTIVATE" : "ADMIN_USER_UPDATE",
      userId: admin.id,
      metadata: { targetUserId: id, changes: Object.keys(data) },
    });
    return NextResponse.json({ data: updated });
  });
}
