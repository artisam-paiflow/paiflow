import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { signupCodeSelect } from "@/lib/auth/google-signup";
import { withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { audit } from "@/lib/audit";

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const admin = await requireSession({ role: Role.ADMIN });
    await enforceWriteRateLimit("adminWrite", admin.id);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const row = await db.googleSignupCode.update({
      where: { id },
      data: { disabledAt: new Date() },
      select: signupCodeSelect,
    });
    await audit({
      action: "ADMIN_GOOGLE_SIGNUP_CODE_DISABLE",
      userId: admin.id,
      metadata: { codeId: id },
    });
    return NextResponse.json({ data: row }, { headers: { "Cache-Control": "no-store" } });
  });
}
