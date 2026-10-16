import "server-only";
import type { NextRequest } from "next/server";
import {
  Role,
  type Deployment,
  type DeveloperApiToken,
  type DeploymentApiToken,
} from "@prisma/client";
import { db } from "@/lib/db";
import { hashApiToken, tokenUsageStamp } from "@/lib/auth/api-token";
import { audienceFor, type Audience } from "@/lib/analytics/policy";
import { DEVELOPER_API_TOKEN_PATTERN } from "@/lib/developer-tokens/schema";
import { AppError } from "@/lib/errors";

/** `pfk_` + 32 random bytes as hex. Anything else is refused before the DB is
 * asked, which also keeps a `DevApiToken` (`pkdev_…`) from ever being looked up
 * here. */
export const DEPLOYMENT_API_TOKEN_PATTERN = /^pfk_[0-9a-f]{64}$/;

type LegacyTokenAuth = {
  tokenType: "deployment_token";
  ownerId: string;
  tokenCreatorId: string | null;
  token: Omit<DeploymentApiToken, "tokenHash">;
  deployment: Deployment;
  analyticsAudience: Audience;
};

export { DEVELOPER_API_TOKEN_PATTERN } from "@/lib/developer-tokens/schema";
export type DeveloperTokenAuth = {
  tokenType: "developer_token";
  token: Omit<DeveloperApiToken, "tokenHash">;
  ownerId: string;
  tokenCreatorId: string;
  analyticsAudience: Audience;
  deployment: Deployment | null;
};
export type ApiCredentialAuth = LegacyTokenAuth | DeveloperTokenAuth;
export type DeploymentTokenAuth = ApiCredentialAuth & { deployment: Deployment };

/** A live credential with no grant. Do not negatively cache its mutable deployment selection. */
export class DeploymentGrantRefusal extends AppError {
  constructor(public readonly credential: ApiCredentialAuth) {
    super("UNAUTHENTICATED", "A valid API token for this deployment is required");
  }
}

export type ApiTokenType = ApiCredentialAuth["tokenType"];
/** Preserve legacy lease keys while separating the independently allocated token-ID namespaces. */
export function apiTokenKey(tokenId: string, tokenType?: ApiTokenType) {
  return tokenType === "developer_token" ? `developer:${tokenId}` : tokenId;
}
export function signedTokenAttribution(input: { tokenId: string; tokenType?: ApiTokenType }) {
  return input.tokenType === "developer_token"
    ? { developerApiTokenId: input.tokenId }
    : { apiTokenId: input.tokenId };
}

// One message for every refusal: a caller probing with a stolen or guessed
// token must not learn whether it was unknown, revoked, expired or bound to
// another deployment. Also what `lib/api/v1/pre-auth.ts` answers a recently
// refused token with, so a cached refusal reads the same as a looked-up one.
export const refusedDeploymentToken = () =>
  new AppError("UNAUTHENTICATED", "A valid API token for this deployment is required");
const refused = refusedDeploymentToken;

/** The request's supported `Authorization: Bearer pfk_…|pfd_…` token when it is well-formed, else null. No DB. */
export function bearerDeploymentToken(req: NextRequest): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  const raw = match?.[1];
  return raw && (DEPLOYMENT_API_TOKEN_PATTERN.test(raw) || DEVELOPER_API_TOKEN_PATTERN.test(raw))
    ? raw
    : null;
}

/**
 * Authenticate an `/api/v1` request against one deployment.
 *
 * `Authorization: Bearer <token>` only: no `x-dev-api-secret`, no user-scoped
 * `DevApiToken`, no session fallback. Where `requireDevAuth` resolves a user who
 * then owns whatever they touch, a credential here must match its deployment binding
 * or explicit grant. Omitting deploymentId authenticates only for scoped discovery.
 */
export function requireDeploymentToken(
  req: NextRequest,
  deploymentId: string,
): Promise<DeploymentTokenAuth>;
export function requireDeploymentToken(req: NextRequest): Promise<ApiCredentialAuth>;
export async function requireDeploymentToken(
  req: NextRequest,
  deploymentId?: string,
): Promise<ApiCredentialAuth> {
  const raw = bearerDeploymentToken(req);
  if (!raw) throw refused();

  if (DEVELOPER_API_TOKEN_PATTERN.test(raw)) {
    const row = await db.developerApiToken.findUnique({
      where: { tokenHash: hashApiToken(raw) },
      include: { owner: { select: { isActive: true, role: true, analyticsAudience: true } } },
    });
    if (
      !row ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
      !row.owner.isActive ||
      row.owner.role === Role.SANDBOX
    )
      throw refused();
    const { tokenHash: _hash, owner, ...token } = row;
    const credential: DeveloperTokenAuth = {
      tokenType: "developer_token",
      token,
      ownerId: row.ownerId,
      tokenCreatorId: row.ownerId,
      analyticsAudience: audienceFor(owner),
      deployment: null,
    };
    if (deploymentId) {
      const deployment = await db.deployment.findFirst({
        where: {
          id: deploymentId,
          ownerId: row.ownerId,
          status: "CONFIRMED",
          serviceState: "ACTIVE",
          developerTokenGrants: { some: { tokenId: row.id } },
        },
      });
      if (!deployment) throw new DeploymentGrantRefusal(credential);
      credential.deployment = deployment;
    }
    const stamp = tokenUsageStamp(row.lastUsedAt);
    if (stamp)
      void db.developerApiToken
        .updateMany({
          where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: stamp.cutoff } }] },
          data: { lastUsedAt: stamp.now },
        })
        .catch(() => {});
    return credential;
  }
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
    (deploymentId !== undefined && row.deploymentId !== deploymentId) ||
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

  // Best-effort activity stamp, at most once per five minutes. The database
  // predicate also prevents overlapping requests from writing the same interval.
  const stamp = tokenUsageStamp(row.lastUsedAt);
  if (stamp) {
    db.deploymentApiToken
      .update({
        where: {
          id: row.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: stamp.cutoff } }],
        },
        data: { lastUsedAt: stamp.now },
      })
      .catch(() => {});
  }

  const { tokenHash: _tokenHash, deployment, ...token } = row;
  const { owner: _owner, ...deploymentRow } = deployment;
  return {
    tokenType: "deployment_token",
    ownerId: deploymentRow.ownerId,
    tokenCreatorId: token.createdById,
    token,
    deployment: deploymentRow,
    analyticsAudience: audienceFor(_owner),
  };
}
