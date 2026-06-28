import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { setPdaxCredential } from "@/lib/offramp/pdax-auth";

const CredentialSchema = z.object({
  username: z.string().min(1).max(256),
  accessToken: z.string().optional().nullable(),
  idToken: z.string().optional().nullable(),
  refreshToken: z.string().optional().nullable(),
  apiUrl: z.string().url().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(_req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });

    const credential = await db.offRampProviderCredential.findUnique({
      where: { provider: "pdax" },
    });

    if (!credential) {
      return NextResponse.json({ data: { credential: null } });
    }

    return NextResponse.json({
      data: {
        credential: {
          provider: credential.provider,
          username: credential.username,
          apiUrl: credential.apiUrl,
          expiresAt: credential.expiresAt?.toISOString() ?? null,
          updatedAt: credential.updatedAt.toISOString(),
          hasAccessToken: Boolean(credential.accessToken),
          hasIdToken: Boolean(credential.idToken),
          hasRefreshToken: Boolean(credential.refreshToken),
        },
      },
    });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });

    const body = CredentialSchema.parse(await req.json());

    const existing = await db.offRampProviderCredential.findUnique({
      where: { provider: "pdax" },
    });

    const accessToken = body.accessToken?.trim() || existing?.accessToken;
    const idToken = body.idToken?.trim() || existing?.idToken;
    const refreshToken = body.refreshToken?.trim() || existing?.refreshToken;
    if (!accessToken) {
      throw new AppError("VALIDATION", "Access token is required");
    }

    await setPdaxCredential({
      username: body.username,
      accessToken,
      idToken,
      refreshToken,
      apiUrl: body.apiUrl,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });

    return NextResponse.json({ data: { saved: true } });
  });
}
