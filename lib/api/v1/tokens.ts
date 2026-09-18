import "server-only";
import crypto from "node:crypto";
import { Role, type DeploymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession, type SessionUser } from "@/lib/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";

export const MAX_ACTIVE_API_TOKENS = 10;

/** The label every token minted by `POST /api/v1/demo-token` carries. */
export const DEMO_TOKEN_LABEL = "public demo";

/**
 * Cap on live demo tokens for the demo deployment, deliberately separate from
 * `MAX_ACTIVE_API_TOKENS`, which bounds an *owner's* own credentials on their
 * own deployment. Ten would lock out the eleventh reviewer, so the demo route
 * evicts oldest-first instead of refusing. Derived from the instance-wide
 * hourly limit so the two cannot drift: with a 60-minute life, that limiter
 * already bounds live demo tokens at this number, and the cap is the belt.
 */
export const DEMO_MAX_ACTIVE_TOKENS = V1_RATE_LIMITS.demoTokenGlobal.limit;

/**
 * What counts as a live demo token, and so what the demo route may evict.
 * Both discriminators are required: a token an operator minted by hand on the
 * demo deployment always has a non-null `createdById`, and must never be
 * revocable by a stranger's request.
 */
export function demoTokenFilter(now: Date) {
  return {
    label: DEMO_TOKEN_LABEL,
    createdById: null,
    revokedAt: null,
    expiresAt: { gt: now },
  };
}

/** Every field of a `DeploymentApiToken` a route may return: all but the hash. */
export const API_TOKEN_SELECT = {
  id: true,
  tokenPrefix: true,
  label: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

/** `pfk_` + 32 random bytes as hex, matching `DEPLOYMENT_API_TOKEN_PATTERN`. */
export function generateDeploymentApiToken(): {
  plaintext: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const plaintext = `pfk_${crypto.randomBytes(32).toString("hex")}`;
  return { plaintext, tokenHash: hashApiToken(plaintext), tokenPrefix: plaintext.slice(0, 12) };
}

/** What counts toward `MAX_ACTIVE_API_TOKENS`: not revoked and not yet expired. */
export function activeTokenFilter(now: Date) {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/**
 * The guard shared by the token-management routes: a signed-in, non-sandbox
 * owner of the deployment. A deployment the caller does not own is a 404, not
 * a 403, so its existence is not disclosed.
 */
export async function requireTokenManager(
  deploymentId: string,
): Promise<{ user: SessionUser; deployment: { id: string; status: DeploymentStatus } }> {
  const user = await requireSession();
  // A sandbox identity is disposable; a token it minted would outlive it with
  // no owner to revoke it. Middleware blocks these paths too.
  if (user.role === Role.SANDBOX) {
    throw new AppError("FORBIDDEN", "Not available in the sandbox");
  }
  if (!isUuid(deploymentId)) throw new AppError("NOT_FOUND", "Deployment not found");

  await enforceRateLimit({ key: `api-tokens:${user.id}`, ...V1_RATE_LIMITS.apiTokens });

  const deployment = await db.deployment.findFirst({
    where: { id: deploymentId, ownerId: user.id },
    select: { id: true, status: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
  return { user, deployment };
}
