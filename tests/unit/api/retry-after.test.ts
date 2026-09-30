import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockSession } = vi.hoisted(() => {
  process.env.ALLOW_PUBLIC_REGISTRATION = "true";
  return { mockSession: vi.fn() };
});

vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ getSessionUser: mockSession, requireSession: vi.fn() }));
vi.mock("@/lib/stellar/balances", () => ({ getWorkflowBalances: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST as register } from "@/app/api/auth/register/route";
import { GET as balances } from "@/app/api/deployments/[id]/balances/route";
import { CALLER_RATE_LIMITS, rateLimitedError, retryAfterSeconds } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/errors";

describe("retryAfterSeconds / rateLimitedError", () => {
  it("rounds up to whole seconds, minimum 1", () => {
    expect(retryAfterSeconds({ resetAt: Date.now() + 2_100 })).toBe(3);
    expect(retryAfterSeconds({ resetAt: Date.now() + 10 })).toBe(1);
    expect(retryAfterSeconds({ resetAt: Date.now() - 5_000 })).toBe(1);
  });

  it("builds a RATE_LIMITED error that becomes a Retry-After header", () => {
    const err = rateLimitedError({ resetAt: Date.now() + 41_000 }, "slow down");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe("slow down");
    const res = errorResponse(err);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(40);
  });
});

describe("routes that call rateLimit() directly send Retry-After", () => {
  it("auth/register (standard error body)", async () => {
    const ip = "203.0.113.50";
    const call = () =>
      register(
        new NextRequest("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "x-forwarded-for": ip, "content-type": "application/json" },
          body: "{}",
        }),
      );
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) last = await call();
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await last!.json()).error.code).toBe("RATE_LIMITED");
  });

  it("balances (non-standard body kept)", async () => {
    const ip = "203.0.113.51";
    const id = "11111111-1111-1111-1111-111111111111";
    mockSession.mockResolvedValue({ id: "u1", username: "u", role: "USER" });
    let last: Response | undefined;
    for (let i = 0; i <= CALLER_RATE_LIMITS.balances.ipBackstop.limit; i++) {
      last = await balances(
        new NextRequest(`http://localhost/api/deployments/${id}/balances`, {
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ id }) },
      );
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await last!.json()).toEqual({ error: "Rate limit exceeded" });
  });
});
