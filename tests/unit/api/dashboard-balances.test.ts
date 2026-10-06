import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReadWorkflowBalances } from "@/lib/stellar/balances";

const { session, findFirst, limit, load } = vi.hoisted(() => ({
  session: vi.fn(),
  findFirst: vi.fn(),
  limit: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: session }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst } } }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: limit,
}));
vi.mock("@/lib/stellar/balances", () => ({ getWorkflowBalances: load }));

const id = "11111111-1111-4111-8111-111111111111";
const deployment = {
  id,
  ownerId: "owner",
  status: "CONFIRMED",
  sourceAccount: "source",
  graphSnapshot: null,
  pipelineSnapshot: [],
  contractAddress: "contract",
  flow: { templateKind: "PAYER" },
};
const result: ReadWorkflowBalances = {
  totals: [],
  nodes: [],
  freshness: {
    status: "fresh",
    totalsComplete: true,
    attemptedAt: "2026-10-06T01:00:00Z",
    cached: false,
    targets: [],
  },
};

async function request() {
  const { GET } = await import("@/app/api/deployments/[id]/balances/route");
  return GET(
    new NextRequest(`http://localhost/api/deployments/${id}/balances`, {
      headers: { "x-forwarded-for": "203.0.113.70" },
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  session.mockReset().mockResolvedValue({ id: "owner", role: "USER" });
  findFirst.mockReset().mockResolvedValue(deployment);
  limit.mockReset().mockResolvedValue({ ok: true, resetAt: Date.now() + 1_000 });
  load.mockReset().mockResolvedValue(result);
});

it("checks auth, ownership and both limits even on cache hits, and selects only read inputs", async () => {
  expect((await request()).status).toBe(200);
  const hit = await request();
  expect(hit.status).toBe(200);
  expect((await hit.json()).freshness.cached).toBe(true);
  expect(hit.headers.get("cache-control")).toBe("private, no-store");
  expect(load).toHaveBeenCalledTimes(1);
  expect(session).toHaveBeenCalledTimes(2);
  expect(limit).toHaveBeenCalledTimes(4);
  expect(findFirst).toHaveBeenCalledTimes(2);
  expect(findFirst).toHaveBeenCalledWith({
    where: { id, ownerId: "owner" },
    select: {
      id: true,
      ownerId: true,
      status: true,
      graphSnapshot: true,
      pipelineSnapshot: true,
      contractAddress: true,
      sourceAccount: true,
      flow: { select: { templateKind: true } },
    },
  });
});

it("a warm cache cannot bypass an ended session or another owner's lookup", async () => {
  await request();
  session.mockResolvedValueOnce(null);
  expect((await request()).status).toBe(401);
  session.mockResolvedValueOnce({ id: "other", role: "USER" });
  findFirst.mockResolvedValueOnce(null);
  expect((await request()).status).toBe(404);
  expect(findFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { id, ownerId: "other" } }),
  );
  expect(load).toHaveBeenCalledTimes(1);
});

it.each([0, 1])("a warm cache cannot bypass rate-limit guard %s", async (guard) => {
  await request();
  if (guard === 1) limit.mockResolvedValueOnce({ ok: true });
  limit.mockResolvedValueOnce({ ok: false, resetAt: Date.now() + 10_000 });
  const response = await request();
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(load).toHaveBeenCalledTimes(1);
});

it("does not return cached balances after deployment status changes", async () => {
  await request();
  findFirst.mockResolvedValueOnce({ ...deployment, status: "FAILED" });
  const response = await request();
  expect(await response.json()).toEqual({ totals: [], nodes: [] });
  expect(load).toHaveBeenCalledTimes(1);
});
