import "server-only";
import type { NextRequest } from "next/server";
import { Role, type Deployment, type DeploymentApiToken } from "@prisma/client";
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { audienceFor, type Audience } from "@/lib/analytics/policy";
import { AppError } from "@/lib/errors";

/** `pfk_` + 32 random bytes as hex. Anything else is refused before the DB is
 * asked, which also keeps a `DevApiToken` (`pkdev_…`) from ever being looked up
 * here. */
export const DEPLOYMENT_API_TOKEN_PATTERN = /^pfk_[0-9a-f]{64}$/;

export type DeploymentTokenAuth = {
  token: Omit<DeploymentApiToken, "tokenHash">;
  deployment: Deployment;
  analyticsAudience: Audience;
};

// One message for every refusal: a caller probing with a stolen or guessed
// token must not learn whether it was unknown, revoked, expired or bound to
// another deployment. Also what `lib/api/v1/pre-auth.ts` answers a recently
// refused token with, so a cached refusal reads the same as a looked-up one.
export const refusedDeploymentToken = () =>
  new AppError("UNAUTHENTICATED", "A valid API token for this deployment is required");
const refused = refusedDeploymentToken;

/** The request's `Authorization: Bearer pfk_…` token when it is well-formed, else null. No DB. */
export function bearerDeploymentToken(req: NextRequest): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  const raw = match?.[1];
  return raw && DEPLOYMENT_API_TOKEN_PATTERN.test(raw) ? raw : null;
}

/**
 * Authenticate an `/api/v1` request against one deployment.
 *
 * `Authorization: Bearer <token>` only: no `x-dev-api-secret`, no user-scoped
 * `DevApiToken`, no session fallback. Where `requireDevAuth` resolves a user who
 * then owns whatever they touch, a token here reaches exactly the one deployment
 * it was minted for.
 */
export async function requireDeploymentToken(
  req: NextRequest,
  deploymentId: string,
): Promise<DeploymentTokenAuth> {
  const raw = bearerDeploymentToken(req);
  if (!raw) throw refused();

  const row = await db.deploymentApiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: {
      deployment: {
        include: { owner: { select: { isActive: true, role: true, analyticsAudience: true } } },
      },
    },
  });

  if (
    !row ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
    row.deploymentId !== deploymentId ||
    !row.deployment.owner.isActive ||
    row.deployment.serviceState !== "ACTIVE"
  ) {
    throw refused();
  }

  // Defence in depth: the mint route never issues a token on a sandbox-owned
  // deployment, so reaching this means that guard was bypassed.
  if (row.deployment.owner.role === Role.SANDBOX) {
    throw new AppError("FORBIDDEN", "Not available in the sandbox");
  }

  // Best-effort last-used stamp; never block the request on it.
  db.deploymentApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const { tokenHash: _tokenHash, deployment, ...token } = row;
  const { owner: _owner, ...deploymentRow } = deployment;
  return { token, deployment: deploymentRow, analyticsAudience: audienceFor(_owner) };
}
