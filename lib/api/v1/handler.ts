import "server-only";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { withErrorHandler, AppError } from "@/lib/errors";
import { hashApiToken } from "@/lib/auth/api-token";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { bearerDeploymentToken, requireDeploymentToken, type DeploymentTokenAuth } from "./auth";
import { guardBeforeAuth, markTokenKnown, recordAuthFailure } from "./pre-auth";

export type V1RouteOptions = {
  rateLimit: { limit: number; windowSeconds: number };
};

export type V1Params = { id: string };

export type V1Context<P extends V1Params> = DeploymentTokenAuth & {
  req: NextRequest;
  params: P;
};

export const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

// A client-supplied id is echoed only if it looks like one; anything else is
// replaced rather than reflected back. When the client sends none, the id
// middleware.ts generates wins on the wire; this fallback only shows when the
// handler runs without middleware (unit tests).
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function requestId(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

const V1_ROUTE = Symbol.for("paiflow.v1Route");

/** True for a handler `v1Route` built. The route-coverage test asserts it of every v1 export. */
export function isV1Route(handler: unknown): boolean {
  return typeof handler === "function" && V1_ROUTE in handler;
}

/**
 * The guard every `/api/v1/deployments/{id}/…` handler is wrapped in, in this
 * order: error envelope, UUID check on `id` (a malformed id is a 404, never a
 * Prisma 500), the per-address guards that run before any DB work
 * (`guardBeforeAuth`: a recently refused token is answered without a lookup,
 * and lookups of tokens never seen are bounded per address, tighter once it has
 * too many failed authentications), deployment-token auth (each refusal
 * counted against the address), then a rate limit keyed on the token id.
 *
 * The real limit is keyed on the token, not the caller's IP, because many
 * partners can share an address and `clientIp` is only as honest as the edge in
 * front (#433); the per-IP guards are built never to refuse a valid token
 * (#524). `middleware.ts` lists `/api/v1` as public; this wrapper is what
 * actually closes each route, and `tests/unit/api/v1/route-coverage.test.ts`
 * fails if a v1 route is exported without it.
 */
export function v1Route<P extends V1Params>(
  opts: V1RouteOptions,
  fn: (ctx: V1Context<P>) => Promise<Response>,
) {
  const handler = async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const rid = requestId(req);
    const res = await withErrorHandler(async () => {
      const params = await ctx.params;
      if (!isUuid(params.id)) throw new AppError("NOT_FOUND", "Deployment not found");

      const route = new URL(req.url).pathname.replace(params.id, ":id");
      const ip = clientIp(req);
      const raw = bearerDeploymentToken(req);
      const tokenHash = raw ? hashApiToken(raw) : null;
      await guardBeforeAuth(ip, route, params.id, tokenHash);

      let auth: DeploymentTokenAuth;
      try {
        auth = await requireDeploymentToken(req, params.id);
      } catch (err) {
        if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
          await recordAuthFailure(ip, route, params.id, tokenHash);
        }
        throw err;
      }
      // Not awaited, like the lastUsedAt stamp: it never throws and must not add latency.
      if (tokenHash) void markTokenKnown(tokenHash, auth.token.expiresAt);

      await enforceRateLimit({
        key: `v1:${route}:${auth.token.id}`,
        limit: opts.rateLimit.limit,
        windowSeconds: opts.rateLimit.windowSeconds,
      });

      return fn({ req, params, ...auth });
    });
    res.headers.set("x-request-id", rid);
    return res;
  };
  return Object.defineProperty(handler, V1_ROUTE, { value: true });
}
