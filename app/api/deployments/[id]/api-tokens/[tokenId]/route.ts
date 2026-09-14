import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, withErrorHandler } from "@/lib/errors";
import { clientIp } from "@/lib/rate-limit";
import { isUuid } from "@/lib/api/v1/handler";
import { API_TOKEN_SELECT, requireTokenManager } from "@/lib/api/v1/tokens";

type Ctx = { params: Promise<{ id: string; tokenId: string }> };

/**
 * Revoke a token. The row is kept, never deleted, so the audit trail keeps its
 * subject. Revoking an already-revoked token returns it unchanged.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const { id, tokenId } = await ctx.params;
    const { user, deployment } = await requireTokenManager(id);
    if (!isUuid(tokenId)) throw new AppError("NOT_FOUND", "Token not found");

    const existing = await db.deploymentApiToken.findFirst({
      where: { id: tokenId, deploymentId: deployment.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("NOT_FOUND", "Token not found");

    // Conditional on `revokedAt: null` so two concurrent revokes write one
    // audit row between them, not two.
    const { count } = await db.deploymentApiToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = await db.deploymentApiToken.findUniqueOrThrow({
      where: { id: existing.id },
      select: API_TOKEN_SELECT,
    });
    if (count === 0) return NextResponse.json({ data: token });

    await audit({
      action: "API_TOKEN_REVOKED",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      metadata: { deploymentId: deployment.id, tokenId: token.id, tokenPrefix: token.tokenPrefix },
    });

    return NextResponse.json({ data: token });
  });
}
