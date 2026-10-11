import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createGoogleSignupCode, signupCodeSelect } from "@/lib/auth/google-signup";
import { withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { audit } from "@/lib/audit";

export async function GET() {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    return NextResponse.json(
      {
        data: await db.googleSignupCode.findMany({
          select: signupCodeSelect,
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const admin = await requireSession({ role: Role.ADMIN });
    await enforceWriteRateLimit("adminWrite", admin.id);
    const result = await createGoogleSignupCode(await req.json());
    await audit({
      action: "ADMIN_GOOGLE_SIGNUP_CODE_CREATE",
      userId: admin.id,
      metadata: { codeId: result.id },
    });
    return NextResponse.json(
      { data: result },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
