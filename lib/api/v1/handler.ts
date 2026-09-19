import "server-only";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { withErrorHandler, AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireDeploymentToken, type DeploymentTokenAuth } from "./auth";

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

/**
 * The guard every `/api/v1/deployments/{id}/…` handler is wrapped in, in this
 * order: error envelope, UUID check on `id` (a malformed id is a 404, never a
 * Prisma 500), deployment-token auth, then a rate limit keyed on the token id.
 *
 * The limit is keyed on the token, not the caller's IP, because `clientIp`
 * trusts the first `X-Forwarded-For` hop (#433). `middleware.ts` lists
 * `/api/v1` as public; this wrapper is what actually closes each route.
 */
export function v1Route<P extends V1Params>(
  opts: V1RouteOptions,
  fn: (ctx: V1Context<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const rid = requestId(req);
    const res = await withErrorHandler(async () => {
      const params = await ctx.params;
      if (!isUuid(params.id)) throw new AppError("NOT_FOUND", "Deployment not found");

      const auth = await requireDeploymentToken(req, params.id);

      const route = new URL(req.url).pathname.replace(params.id, ":id");
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
}
