import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  deployment: vi.fn(),
  current: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
  history: vi.fn(),
  limit: vi.fn(),
  serviceRoute: vi.fn((fn: unknown) => fn),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mock.session }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mock.deployment } } }));
vi.mock("@/lib/deployments/service-route", () => ({ deploymentServiceRoute: mock.serviceRoute }));
vi.mock("@/lib/stellar/mutation-state", () => ({ readMutationState: mock.current }));
vi.mock("@/lib/mutations/service", () => ({
  prepareMutation: mock.prepare,
  submitMutation: mock.submit,
  reconcileMutation: mock.reconcile,
}));
vi.mock("@/lib/mutations/history", () => ({ configurationHistory: mock.history }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: mock.limit }));
import { GET as getState } from "@/app/api/deployments/[id]/configuration/route";
import { POST as prepare } from "@/app/api/deployments/[id]/configuration/prepare/route";
import { POST as submit } from "@/app/api/deployments/[id]/configuration/submit/route";
import { ownerMutationRoute } from "@/lib/mutations/http";
import { AppError } from "@/lib/errors";
import { admin, intent } from "./fixtures";
import type { Deployment } from "@prisma/client";
const id = "11111111-1111-4111-8111-111111111111",
  userId = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id }) };
const request = (path: string, body?: unknown, key?: string) =>
  new NextRequest(`https://example.com/api/deployments/${id}/configuration${path}`, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({ id: userId, role: "USER" });
  mock.deployment.mockResolvedValue({ id, ownerId: userId });
  mock.current.mockResolvedValue({ confirmedLedger: 100 });
  mock.prepare.mockResolvedValue({ intent: id });
  mock.submit.mockResolvedValue({ status: "UNKNOWN" });
  mock.reconcile.mockResolvedValue({ transaction: { txHash: "a".repeat(64) } });
  mock.limit.mockResolvedValue(undefined);
});
describe("owner mutation routes", () => {
  it.each(["prepare", "submit", "reconcile"] as const)(
    "%s delegates owner service admission and its exact rate bucket before domain work",
    async (action) => {
      const handler = ownerMutationRoute(action);
      expect(mock.serviceRoute).toHaveBeenLastCalledWith(expect.any(Function), "owner");
      const body =
        action === "prepare"
          ? { admin: admin.publicKey(), arguments: intent({ id } as Deployment).arguments }
          : action === "submit"
            ? { intent: id, signedXdr: "test-signature-placeholder" }
            : { intent: id };
      await handler(request(`/${action}`, body, "update:1"), ctx);
      expect(mock.limit).toHaveBeenCalledWith({
        key: `configuration:${action}:${userId}`,
        limit: action === "prepare" ? 10 : 30,
        windowSeconds: 60,
      });
      expect(
        action === "prepare" ? mock.prepare : action === "submit" ? mock.submit : mock.reconcile,
      ).toHaveBeenCalledOnce();
    },
  );
  it.each(["prepare", "submit", "reconcile"] as const)(
    "%s rate refusal stops deployment lookup and domain work",
    async (action) => {
      mock.limit.mockRejectedValue(new AppError("RATE_LIMITED", "Too many requests"));
      const handler = ownerMutationRoute(action);
      await expect(handler(request(`/${action}`, {}), ctx)).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
      expect(mock.deployment).not.toHaveBeenCalled();
      expect(mock.prepare).not.toHaveBeenCalled();
      expect(mock.submit).not.toHaveBeenCalled();
      expect(mock.reconcile).not.toHaveBeenCalled();
    },
  );

  it("refuses ended sessions, foreign deployments and sandbox before chain reads", async () => {
    mock.session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Session required"));
    await expect(getState(request(""), ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    mock.session.mockResolvedValue({ id: userId, role: "USER" });
    mock.deployment.mockResolvedValue(null);
    await expect(getState(request(""), ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    mock.session.mockResolvedValue({ id: userId, role: "SANDBOX" });
    await expect(getState(request(""), ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.current).not.toHaveBeenCalled();
  });
  it("requires owner/deployment/network scope and returns uncached confirmed state", async () => {
    const res = await getState(request(""), ctx);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mock.deployment).toHaveBeenCalledWith({
      where: {
        id,
        ownerId: userId,
        network: "testnet",
        status: "CONFIRMED",
        serviceState: "ACTIVE",
      },
    });
    expect(await res.json()).toEqual({ data: { confirmedLedger: 100 } });
  });
  it("requires strict body/idempotency and passes explicit authenticated owner attribution", async () => {
    const body = { admin: admin.publicKey(), arguments: intent({ id } as Deployment).arguments };
    await expect(prepare(request("/prepare", body), ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(mock.prepare).not.toHaveBeenCalled();
    await prepare(request("/prepare", body, "update:1"), ctx);
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    await submit(request("/submit", { intent: id, signedXdr: "test-signature-placeholder" }), ctx);
    expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({ ownerSessionId: userId }));
    expect(mock.submit.mock.calls[0]![0]).not.toHaveProperty("tokenId");
  });
});
