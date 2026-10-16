import "server-only";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { assertDeploymentService, withDeploymentWork } from "@/lib/deployments/service-work";
import { env } from "@/lib/env";
import { queueApiRequest } from "@/lib/api/request-history/delivery";
import {
  ApiRequestRecordSchema,
  API_HISTORY_VERSION,
  requestEndpoint,
} from "@/lib/api/request-history/schema";
import { requestHistoryContext } from "@/lib/api/request-history/context";
import { withErrorHandler, AppError } from "@/lib/errors";
import { hashApiToken } from "@/lib/auth/api-token";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  apiTokenKey,
  bearerDeploymentToken,
  requireDeploymentToken,
  DeploymentGrantRefusal,
  type ApiCredentialAuth,
  type DeploymentTokenAuth,
} from "./auth";
import { assertApiPermission, type V1Operation } from "./permissions";
import { guardBeforeAuth, markTokenKnown, recordAuthFailure } from "./pre-auth";

export type V1RouteOptions = {
  operation: V1Operation;
  rateLimit: { limit: number; windowSeconds: number };
  /** Stable route bucket for paths with caller-controlled segments such as a transaction hash. */
  rateLimitRoute?: string;
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
export function v1RouteOperation(handler: unknown): V1Operation | null {
  return typeof handler === "function" && V1_ROUTE in handler
    ? ((handler as unknown as Record<symbol, V1Operation>)[V1_ROUTE] ?? null)
    : null;
}

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
  return createV1Route(
    opts,
    async (req, params: P) => {
      if (!isUuid(params.id)) throw new AppError("NOT_FOUND", "Deployment not found");
      return requireDeploymentToken(req, params.id);
    },
    fn,
  );
}

/** Discovery has the same bearer, rate-limit, error and history guards as deployment routes. */
export function v1DiscoveryRoute(
  fn: (
    ctx: ApiCredentialAuth & { req: NextRequest; params: Record<string, never> },
  ) => Promise<Response>,
) {
  return createV1Route(
    { operation: "GET deployments", rateLimit: { limit: 60, windowSeconds: 60 } },
    (req) => requireDeploymentToken(req),
    fn,
  );
}

function createV1Route<P extends { id?: string }, A extends ApiCredentialAuth>(
  opts: V1RouteOptions,
  authenticate: (req: NextRequest, params: P) => Promise<A>,
  fn: (ctx: A & { req: NextRequest; params: P }) => Promise<Response>,
) {
  const handler = async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const started = performance.now();
    const occurredAt = new Date().toISOString();
    const telemetryId = crypto.randomUUID();
    const rid = requestId(req);
    let authenticated: ApiCredentialAuth | null = null;
    let failureCode: import("@/lib/errors").AppErrorCode | "HTTP_ERROR" | null = null;
    const history = { txHash: null as string | null };
    const res = await requestHistoryContext.run(history, () =>
      withErrorHandler(async () => {
        try {
          const params = await ctx.params;
          if (params.id !== undefined && !isUuid(params.id))
            throw new AppError("NOT_FOUND", "Deployment not found");

          // The operation is stable across selected deployments and dynamic transaction hashes.
          const route =
            opts.rateLimitRoute ??
            (params.id
              ? `/api/v1/deployments/:id/${opts.operation?.split(" ")[1] ?? ":unknown"}`
              : "/api/v1/deployments");
          const ip = clientIp(req);
          const raw = bearerDeploymentToken(req);
          const tokenHash = raw ? hashApiToken(raw) : null;
          await guardBeforeAuth(ip, route, params.id ?? "discovery", tokenHash);

          let auth: A;
          try {
            auth = await authenticate(req, params);
          } catch (err) {
            if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
              if (err instanceof DeploymentGrantRefusal) {
                if (tokenHash) await markTokenKnown(tokenHash, err.credential.token.expiresAt);
                authenticated = err.credential;
                await recordAuthFailure(ip, route, params.id ?? "discovery", tokenHash, true);
                await enforceRateLimit({
                  key: `v1:${route}:${apiTokenKey(err.credential.token.id, err.credential.tokenType)}`,
                  ...opts.rateLimit,
                });
              } else await recordAuthFailure(ip, route, params.id ?? "discovery", tokenHash);
            }
            throw err;
          }
          authenticated = auth;
          // Not awaited, like the lastUsedAt stamp: it never throws and must not add latency.
          if (tokenHash) void markTokenKnown(tokenHash, auth.token.expiresAt);

          await enforceRateLimit({
            key: `v1:${route}:${apiTokenKey(auth.token.id, auth.tokenType)}`,
            limit: opts.rateLimit.limit,
            windowSeconds: opts.rateLimit.windowSeconds,
          });

          assertApiPermission(auth, opts.operation);

          if (!auth.deployment) return await fn({ req, params, ...auth });
          if (req.method === "GET") {
            await assertDeploymentService(auth.deployment.id);
            return await fn({ req, params, ...auth });
          }
          return await withDeploymentWork(auth.deployment.id, route, () =>
            fn({ req, params, ...auth }),
          );
        } catch (error) {
          failureCode =
            error instanceof AppError
              ? error.code
              : error instanceof ZodError
                ? "VALIDATION"
                : (error as { code?: string })?.code === "P2002"
                  ? "CONFLICT"
                  : (error as { code?: string })?.code === "P2025"
                    ? "NOT_FOUND"
                    : "INTERNAL";
          throw error;
        }
      }),
    );
    // Read only server-controlled context. Never inspect response/request bodies or client IDs.
    const auth = authenticated as ApiCredentialAuth | null;
    try {
      await queueApiRequest({
        id: telemetryId,
        requestId: telemetryId,
        occurredAt,
        accountId: auth?.ownerId ?? null,
        tokenCreatorId: auth?.tokenCreatorId ?? null,
        apiTokenId: auth?.tokenType === "deployment_token" ? auth.token.id : null,
        developerApiTokenId: auth?.tokenType === "developer_token" ? auth.token.id : null,
        deploymentId: auth?.deployment?.id ?? null,
        txHash: history.txHash,
        preparationRequestId:
          auth && new URL(req.url).pathname.endsWith("/submit")
            ? (z.string().uuid().safeParse(req.headers.get("x-preparation-request-id")).data ??
              null)
            : null,
        callerType: auth?.tokenType ?? "unknown",
        method: ApiRequestRecordSchema.shape.method.parse(req.method),
        endpoint: requestEndpoint(new URL(req.url).pathname),
        status: res.status,
        durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))),
        errorCode: failureCode ?? (res.status >= 400 ? "HTTP_ERROR" : null),
        network: env().STELLAR_NETWORK,
        environment: env().NEXT_PUBLIC_APP_ENV,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
        audience: auth?.analyticsAudience ?? "UNCLASSIFIED",
        trackingVersion: API_HISTORY_VERSION,
      });
    } catch {
      /* Telemetry availability cannot change a payment response. */
    }
    res.headers.set("x-request-id", rid);
    res.headers.set("x-history-request-id", telemetryId);
    return res;
  };
  return Object.defineProperty(handler, V1_ROUTE, { value: opts.operation });
}
