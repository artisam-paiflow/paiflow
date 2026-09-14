import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, withErrorHandler } from "@/lib/errors";
import { clientIp } from "@/lib/rate-limit";
import { CreateApiTokenSchema } from "@/lib/api/v1/schema";
import {
  API_TOKEN_SELECT,
  MAX_ACTIVE_API_TOKENS,
  generateDeploymentApiToken,
  requireTokenManager,
} from "@/lib/api/v1/tokens";

type Ctx = { params: Promise<{ id: string }> };

/** List a deployment's API tokens, newest first, revoked and expired included. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const { deployment } = await requireTokenManager(id);

    const tokens = await db.deploymentApiToken.findMany({
      where: { deploymentId: deployment.id },
      select: API_TOKEN_SELECT,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ data: tokens });
  });
}

/** Mint a token for this deployment. The plaintext is in this response only. */
export async function POST(req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const { user, deployment } = await requireTokenManager(id);
    const input = CreateApiTokenSchema.parse(await req.json());

    if (deployment.status !== "CONFIRMED") {
      throw new AppError("VALIDATION", "API tokens can only be created for a confirmed deployment");
    }

    const { plaintext, tokenHash, tokenPrefix } = generateDeploymentApiToken();
    const now = new Date();
    const expiresAt = input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const token = await db.$transaction(async (tx) => {
      // Lock the deployment row so concurrent mints serialize; otherwise two requests can both
      // count nine active tokens under READ COMMITTED and both insert past the cap.
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deployment.id}::uuid FOR UPDATE`;
      const active = await tx.deploymentApiToken.count({
        where: {
          deploymentId: deployment.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (active >= MAX_ACTIVE_API_TOKENS) {
        throw new AppError(
          "CONFLICT",
          `This deployment already has ${MAX_ACTIVE_API_TOKENS} active tokens. Revoke one first.`,
        );
      }
      return tx.deploymentApiToken.create({
        data: {
          deploymentId: deployment.id,
          createdById: user.id,
          tokenHash,
          tokenPrefix,
          label: input.label ?? null,
          expiresAt,
        },
        select: API_TOKEN_SELECT,
      });
    });

    await audit({
      action: "API_TOKEN_CREATED",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      metadata: { deploymentId: deployment.id, tokenId: token.id, tokenPrefix },
    });

    return NextResponse.json({ data: { ...token, token: plaintext } }, { status: 201 });
  });
}
