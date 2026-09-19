import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { demoApiDeploymentId, env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { log } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSwapperPipeline } from "@/lib/api/v1/execute";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import {
  API_TOKEN_SELECT,
  DEMO_MAX_ACTIVE_TOKENS,
  DEMO_TOKEN_LABEL,
  demoTokenFilter,
  generateDeploymentApiToken,
} from "@/lib/api/v1/tokens";

/** A demo token lives an hour: long enough for a reviewer to fund an account, read the guide and
 * run prepare → sign → submit → poll unhurried, short enough that one pasted into a bug report or
 * a screen recording is dead before anyone can use it. Not `CreateApiTokenSchema.expiresInDays`,
 * whose floor is a whole day. */
const DEMO_TOKEN_TTL_MS = 60 * 60 * 1000;

/** One message for every way the demo deployment can be unusable. See the route docblock. */
const UNAVAILABLE = "The demo API is not available right now";

/**
 * Hand an unauthenticated caller a short-lived token for one shared, operator-provisioned swapper
 * deployment, so the partner API can be exercised without an account (SOW §3.8).
 *
 * Not wrapped in `v1Route`: there is no `{id}` param and no bearer token to authenticate, exactly
 * like the sibling `openapi.json` route. `middleware.ts` lists `/api/v1` in `PUBLIC_PATHS`, so the
 * guards below are the only ones.
 *
 * **Why this mutating route has no `requireSession()`** (CLAUDE.md §10). `app/api/auth/sandbox`
 * is the accepted precedent for an anonymous caller creating a row, and this is a narrower
 * surface than that one: the flag is off by default and `env()` refuses to boot with it on under
 * `STELLAR_NETWORK=mainnet`; two rate limits apply, the instance-wide one failing closed without
 * shared Redis; and the credential issued reaches exactly one pre-vetted testnet deployment for
 * sixty minutes. It is still non-custodial — this hands out a token, never a key, and `execute`
 * remains prepare-only with the caller signing their own envelope.
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const deploymentId = demoApiDeploymentId();
    if (!deploymentId) {
      throw new AppError("FORBIDDEN", "The demo API is not enabled on this instance");
    }

    // Limits before the DB: an anonymous caller must not be able to drive a query by asking.
    const ip = clientIp(req);
    const perIp = await rateLimit(`v1:demo-token:${ip}`, ...limitArgs("demoToken"));
    if (!perIp.ok) {
      throw new AppError("RATE_LIMITED", "Too many demo tokens from this address");
    }
    const global = await rateLimit("v1:demo-token:global", ...limitArgs("demoTokenGlobal"));
    // `shared` is false when rateLimit() fell back to its per-process bucket. clientIp() trusts the
    // first X-Forwarded-For entry, which an attacker sets freely, so the instance-wide cap is the
    // only thing actually bounding how many live credentials this route can mint — and a
    // per-process count does not bound it across replicas. This one fails closed.
    if (!global.shared) {
      log.warn({ ip }, "demo token refused: no shared rate limiter available");
      throw new AppError("RATE_LIMITED", "The demo API is unavailable right now. Try again later.");
    }
    if (!global.ok) {
      throw new AppError("RATE_LIMITED", "The demo API is busy right now. Try again shortly.");
    }

    const deployment = await db.deployment.findUnique({
      where: { id: deploymentId },
      select: {
        id: true,
        status: true,
        network: true,
        pipelineSnapshot: true,
        ownerId: true,
        owner: { select: { isActive: true, role: true } },
      },
    });

    // Every check below collapses to one identical refusal. These are operator misconfigurations,
    // not caller input, and an anonymous prober must not learn the demo deployment's state from
    // the difference between "missing", "still pending" and "wrong shape". The reason goes to the
    // log instead. `resolveSwapperPipeline` throws its own codes, so it is caught here too —
    // ONLY_SWAPPER_FLOWS must not leak out of this route.
    const reason = ((): string | null => {
      if (!deployment) return "deployment row not found";
      if (deployment.network !== env().STELLAR_NETWORK) {
        return `deployment is on ${deployment.network}, instance is on ${env().STELLAR_NETWORK}`;
      }
      if (!deployment.owner?.isActive) return "deployment owner is inactive";
      // A SANDBOX owner would be refused by requireDeploymentToken on every call the token makes,
      // so issuing one would hand out a credential that is dead on arrival.
      if (deployment.owner.role === Role.SANDBOX) return "deployment owner is a sandbox identity";
      try {
        resolveSwapperPipeline(deployment);
      } catch (err) {
        return `not a confirmed swapper pipeline: ${err instanceof AppError ? err.message : String(err)}`;
      }
      return null;
    })();

    if (reason || !deployment) {
      log.error({ deploymentId, reason }, "demo token refused: demo deployment unusable");
      throw new AppError("INTERNAL", UNAVAILABLE);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEMO_TOKEN_TTL_MS);
    const { plaintext, tokenHash, tokenPrefix } = generateDeploymentApiToken();

    const { token, evicted } = await db.$transaction(async (tx) => {
      // Same lock and same reasoning as the owner mint route: it serializes count-then-insert
      // without blocking the KEY SHARE lock that ContractEvent inserts take on this row, so event
      // ingestion never waits on a demo caller.
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId}::uuid FOR NO KEY UPDATE`;

      // Evict oldest-first rather than refusing at the cap: a 409 would lock out the reviewer who
      // arrived last, which is the opposite of what a public demo is for.
      const live = await tx.deploymentApiToken.findMany({
        where: { deploymentId, ...demoTokenFilter(now) },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const overflow = live.length - DEMO_MAX_ACTIVE_TOKENS + 1;
      const stale = overflow > 0 ? live.slice(0, overflow) : [];
      if (stale.length > 0) {
        await tx.deploymentApiToken.updateMany({
          where: { id: { in: stale.map((t) => t.id) } },
          data: { revokedAt: now },
        });
      }

      const created = await tx.deploymentApiToken.create({
        data: {
          deploymentId,
          // No user created this in the product sense, and null is half the discriminator that
          // keeps an operator's own token on this deployment out of the eviction set above.
          createdById: null,
          tokenHash,
          tokenPrefix,
          label: DEMO_TOKEN_LABEL,
          expiresAt,
        },
        select: API_TOKEN_SELECT,
      });
      return { token: created, evicted: stale.map((t) => t.id) };
    });

    await audit({
      action: "API_DEMO_TOKEN_ISSUED",
      userId: deployment.ownerId,
      ip,
      userAgent: req.headers.get("user-agent"),
      metadata: {
        deploymentId,
        tokenId: token.id,
        tokenPrefix,
        expiresAt: expiresAt.toISOString(),
      },
    });
    // One action name for every revocation, so an auditor greps one word.
    for (const tokenId of evicted) {
      await audit({
        action: "API_TOKEN_REVOKED",
        userId: deployment.ownerId,
        ip,
        metadata: { deploymentId, tokenId, reason: "demo-cap-evicted" },
      });
    }

    return NextResponse.json(
      {
        data: {
          deploymentId,
          token: plaintext,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { status: 201 },
    );
  });
}

/** `rateLimit` takes positional args; `V1_RATE_LIMITS` is the published shape. */
function limitArgs(key: "demoToken" | "demoTokenGlobal"): [number, number] {
  const { limit, windowSeconds } = V1_RATE_LIMITS[key];
  return [limit, windowSeconds];
}
