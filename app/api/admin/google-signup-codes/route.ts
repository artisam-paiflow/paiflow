import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { z } from "zod";
import { createGoogleSignupCode, listGoogleSignupCodes } from "@/lib/auth/google-signup";
import { withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const cursor = z
      .string()
      .guid({ error: "Invalid uuid" })
      .optional()
      .parse(req.nextUrl.searchParams.get("cursor") ?? undefined);
    return NextResponse.json(await listGoogleSignupCodes(cursor), {
      headers: { "Cache-Control": "no-store" },
    });
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
