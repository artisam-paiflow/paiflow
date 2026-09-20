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
 * hourly limit so the two cannot drift. The limiter does not make this cap
 * redundant: `rateLimit()` counts fixed windows, so up to twice the limit can be
 * minted inside one 60-minute token life across a window boundary. This cap is
 * what bounds live tokens, and it can evict one that has not expired — cheap to
 * force while `clientIp()` is spoofable (#433).
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
 * What identifies a row as the demo route's, for a query that wants to exclude them. The same two
 * discriminators `demoTokenFilter` requires, without the liveness clauses, so it also matches a
 * demo row that has already expired.
 *
 * Owner-facing queries subtract this. The demo route mints into the operator's own deployment and
 * is bounded by `DEMO_MAX_ACTIVE_TOKENS` (60), six times `MAX_ACTIVE_API_TOKENS` (10) — so without
 * the subtraction ten live demo tokens would refuse the operator's own mint with a `CONFLICT` they
 * cannot clear, since the panel lists at most ten active rows and every one of them would be a
 * demo row. Demo tokens expire in an hour and the demo route evicts its own oldest, so the
 * operator has nothing to manage here.
 */
export function demoTokenIdentity() {
  return { label: DEMO_TOKEN_LABEL, createdById: null };
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
