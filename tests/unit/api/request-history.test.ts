import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), queue: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/api/v1/auth", () => ({
  requireDeploymentToken: mocks.auth,
  bearerDeploymentToken: () => null,
}));
vi.mock("@/lib/api/v1/pre-auth", () => ({
  guardBeforeAuth: vi.fn(),
  markTokenKnown: vi.fn(),
  recordAuthFailure: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: mocks.limit }));
vi.mock("@/lib/api/request-history/delivery", () => ({ queueApiRequest: mocks.queue }));
import { v1Route } from "@/lib/api/v1/handler";
import { AppError } from "@/lib/errors";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import {
  ApiRequestRecordSchema,
  ApiRequestReportSchema,
  requestEndpoint,
} from "@/lib/api/request-history/schema";
const id = randomUUID(),
  account = randomUUID(),
  creator = randomUUID(),
  token = randomUUID();
const request = (suffix = "events") =>
  new NextRequest(`https://app.test/api/v1/deployments/${id}/${suffix}?secret=synthetic`, {
    headers: {
      authorization: "Bearer synthetic",
      "x-request-id": "pfk_synthetic",
      "x-audience": "EXTERNAL",
    },
  });
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    token: { id: token, createdById: creator },
    deployment: { id, ownerId: account },
    analyticsAudience: "INTERNAL",
  });
  mocks.limit.mockResolvedValue(undefined);
  mocks.queue.mockResolvedValue(true);
});
describe("API request history boundary", () => {
  it("records verified caller, token creator and audience without headers, bodies or query", async () => {
    const res = await v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () =>
      NextResponse.json({ data: { token: "synthetic" } }),
    )(request(), ctx);
    const record = mocks.queue.mock.calls[0]![0];
    expect(ApiRequestRecordSchema.parse(record)).toMatchObject({
      accountId: account,
      tokenCreatorId: creator,
      apiTokenId: token,
      audience: "INTERNAL",
      endpoint: "/api/v1/deployments/:id/events",
      status: 200,
      txHash: null,
    });
    expect(JSON.stringify(record)).not.toContain("synthetic");
    expect(record.requestId).toBe(res.headers.get("x-history-request-id"));
  });
  it.each([new AppError("UNAUTHENTICATED", "secret"), new AppError("FORBIDDEN", "secret")])(
    "leaves failed authentication unattributed",
    async (error) => {
      mocks.auth.mockRejectedValue(error);
      await v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () =>
        NextResponse.json({}),
      )(request(), ctx);
      expect(mocks.queue.mock.calls[0]![0]).toMatchObject({
        accountId: null,
        apiTokenId: null,
        deploymentId: null,
        audience: "UNCLASSIFIED",
        errorCode: error.code,
        status: error.status,
      });
    },
  );
  it.each([
    new AppError("UPSTREAM_RPC", "secret"),
    new AppError("RATE_LIMITED", "secret"),
    new AppError("CONFLICT", "secret"),
  ])("records structured thrown failures", async (error) => {
    await v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => {
      throw error;
    })(request(), ctx);
    expect(mocks.queue.mock.calls[0]![0]).toMatchObject({
      accountId: account,
      errorCode: error.code,
      status: error.status,
    });
  });
  it("records validation failures without rejected input", async () => {
    await v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () => {
      z.string().parse(3);
      return NextResponse.json({});
    })(request(), ctx);
    expect(mocks.queue.mock.calls[0]![0]).toMatchObject({ errorCode: "VALIDATION", status: 422 });
  });
  it("keeps telemetry failure from changing the response and distinguishes HTTP retries", async () => {
    mocks.queue.mockRejectedValue(new Error("offline"));
    const route = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () =>
      NextResponse.json({ data: { ok: true } }),
    );
    const a = await route(request(), ctx),
      b = await route(request(), ctx);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get("x-history-request-id")).not.toBe(b.headers.get("x-history-request-id"));
  });
  it("isolates transaction correlation across concurrent requests", async () => {
    const route = v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async ({ req }) => {
      linkApiTransaction(req.headers.get("x-test-hash")!);
      await Promise.resolve();
      return NextResponse.json({});
    });
    const a = request("execute/submit"),
      b = request("execute/submit");
    a.headers.set("x-test-hash", "a".repeat(64));
    b.headers.set("x-test-hash", "b".repeat(64));
    await Promise.all([route(a, ctx), route(b, ctx)]);
    expect(mocks.queue.mock.calls.map((c) => c[0].txHash).sort()).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });
  it("normalizes unknown and hash-bearing paths", () => {
    expect(requestEndpoint(`/api/v1/deployments/credential/transactions/credential`)).toBe(
      "/api/v1/deployments/:id/transactions/:txHash",
    );
    expect(requestEndpoint(`/api/v1/deployments/credential/credential`)).toBe(
      "/api/v1/deployments/:id/:unknown",
    );
  });
  it("rejects unapproved fields, endpoints, identifiers and report windows", async () => {
    await v1Route({ rateLimit: { limit: 5, windowSeconds: 60 } }, async () =>
      NextResponse.json({}),
    )(request(), ctx);
    const record = mocks.queue.mock.calls[0]![0];
    for (const patch of [
      { body: "secret" },
      { endpoint: "/secret" },
      { txHash: "secret" },
      { durationMs: -1 },
      { accountId: "secret" },
    ])
      expect(ApiRequestRecordSchema.safeParse({ ...record, ...patch }).success).toBe(false);
    const input = {
      start: "2026-10-08T00:00:00Z",
      end: "2026-10-09T00:00:00Z",
      network: "testnet",
      audience: "INTERNAL",
      environment: "staging",
    };
    expect(ApiRequestReportSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { end: input.start },
      { end: "2027-01-01T00:00:00Z" },
      { audience: "USER" },
      { token: "secret" },
    ])
      expect(ApiRequestReportSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
