import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

const { mockRequireDeploymentToken } = vi.hoisted(() => ({
  mockRequireDeploymentToken: vi.fn(),
}));

vi.mock("@/lib/api/v1/auth", () => ({ requireDeploymentToken: mockRequireDeploymentToken }));
// No Redis: enforceRateLimit runs on its real in-memory bucket.
vi.mock("@/lib/redis", () => ({ redis: () => null }));

import { v1Route } from "@/lib/api/v1/handler";
import { AppError } from "@/lib/errors";

const DEPLOYMENT_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(path: string, headers: Record<string, string> = {}): NextRequest {
  return {
    url: `https://paiflow.test${path}`,
    headers: new Headers({ authorization: "Bearer pfk_x", ...headers }),
  } as unknown as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let tokenSeq = 0;
function authAs(tokenId: string) {
  mockRequireDeploymentToken.mockResolvedValue({
    token: { id: tokenId },
    deployment: { id: DEPLOYMENT_ID },
  });
}

const ok = () => NextResponse.json({ data: { ok: true } });

beforeEach(() => {
  vi.clearAllMocks();
  authAs(`token-${++tokenSeq}`);
});

describe("v1Route", () => {
  it("hands the handler the params, token and deployment", async () => {
    const fn = vi.fn(async () => ok());
    const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, fn);
    const req = makeReq(`/api/v1/deployments/${DEPLOYMENT_ID}/events`);

    const res = await GET(req, ctx(DEPLOYMENT_ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(mockRequireDeploymentToken).toHaveBeenCalledWith(req, DEPLOYMENT_ID);
    expect(fn).toHaveBeenCalledWith({
      req,
      params: { id: DEPLOYMENT_ID },
      token: { id: `token-${tokenSeq}` },
      deployment: { id: DEPLOYMENT_ID },
    });
  });

  it("returns 404 for a non-UUID id, before authenticating", async () => {
    const fn = vi.fn(async () => ok());
    const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, fn);

    const res = await GET(makeReq("/api/v1/deployments/not-a-uuid/events"), ctx("not-a-uuid"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Deployment not found" },
    });
    expect(mockRequireDeploymentToken).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not run the handler when authentication fails", async () => {
    mockRequireDeploymentToken.mockRejectedValue(new AppError("UNAUTHENTICATED", "nope"));
    const fn = vi.fn(async () => ok());
    const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, fn);

    const res = await GET(
      makeReq(`/api/v1/deployments/${DEPLOYMENT_ID}/events`),
      ctx(DEPLOYMENT_ID),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "nope" } });
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns 429 in the envelope shape once the token's limit is spent", async () => {
    const fn = vi.fn(async () => ok());
    const GET = v1Route({ rateLimit: { limit: 2, windowSeconds: 60 } }, fn);
    const path = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;

    expect((await GET(makeReq(path), ctx(DEPLOYMENT_ID))).status).toBe(200);
    expect((await GET(makeReq(path), ctx(DEPLOYMENT_ID))).status).toBe(200);
    const res = await GET(makeReq(path), ctx(DEPLOYMENT_ID));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keys the limit on the token, so another token is unaffected", async () => {
    const GET = v1Route({ rateLimit: { limit: 1, windowSeconds: 60 } }, async () => ok());
    const path = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;

    authAs("token-first");
    expect((await GET(makeReq(path), ctx(DEPLOYMENT_ID))).status).toBe(200);
    expect((await GET(makeReq(path), ctx(DEPLOYMENT_ID))).status).toBe(429);

    authAs("token-second");
    expect((await GET(makeReq(path), ctx(DEPLOYMENT_ID))).status).toBe(200);
  });

  it("keys the limit per route, so one endpoint does not spend another's", async () => {
    const opts = { rateLimit: { limit: 1, windowSeconds: 60 } };
    const events = v1Route(opts, async () => ok());
    const execute = v1Route(opts, async () => ok());

    authAs("token-per-route");
    const eventsPath = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;
    expect((await events(makeReq(eventsPath), ctx(DEPLOYMENT_ID))).status).toBe(200);
    expect((await events(makeReq(eventsPath), ctx(DEPLOYMENT_ID))).status).toBe(429);
    const executePath = `/api/v1/deployments/${DEPLOYMENT_ID}/execute`;
    expect((await execute(makeReq(executePath), ctx(DEPLOYMENT_ID))).status).toBe(200);
  });

  it("passes an AppError from the handler through withErrorHandler unchanged", async () => {
    const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => {
      throw new AppError("CONFLICT", "Already submitted", { txHash: ["duplicate"] });
    });

    const res = await GET(
      makeReq(`/api/v1/deployments/${DEPLOYMENT_ID}/execute`),
      ctx(DEPLOYMENT_ID),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "CONFLICT", message: "Already submitted", fields: { txHash: ["duplicate"] } },
    });
  });

  it("maps a ZodError from the handler to 422 with fields", async () => {
    const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => {
      z.object({ signedXdr: z.string() }).parse({});
      return ok();
    });

    const res = await GET(
      makeReq(`/api/v1/deployments/${DEPLOYMENT_ID}/execute`),
      ctx(DEPLOYMENT_ID),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fields).toHaveProperty("signedXdr");
  });

  describe("x-request-id", () => {
    const path = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;

    it("echoes the caller's id on success", async () => {
      const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => ok());
      const res = await GET(
        makeReq(path, { "x-request-id": "partner-req-42" }),
        ctx(DEPLOYMENT_ID),
      );
      expect(res.headers.get("x-request-id")).toBe("partner-req-42");
    });

    it("echoes the caller's id on an error", async () => {
      const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => ok());
      const res = await GET(
        makeReq("/api/v1/deployments/bad/events", { "x-request-id": "partner-req-43" }),
        ctx("bad"),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("x-request-id")).toBe("partner-req-43");
    });

    it("generates one when the caller sends none", async () => {
      const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => ok());
      const res = await GET(makeReq(path), ctx(DEPLOYMENT_ID));
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("replaces a malformed id rather than reflecting it", async () => {
      const GET = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => ok());
      const res = await GET(makeReq(path, { "x-request-id": "<script>" }), ctx(DEPLOYMENT_ID));
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
