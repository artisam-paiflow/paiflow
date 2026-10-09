import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  auth: vi.fn(),
  create: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session, auth: mocks.auth }));
vi.mock("@/lib/auth/google", async (original) => ({
  ...(await original<typeof import("@/lib/auth/google")>()),
  createGoogleLinkIntent: mocks.create,
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.limit }));
import { POST } from "@/app/api/account/google/link/route";
import { GoogleAuthError, GoogleLinkSchema } from "@/lib/auth/google";
function request(body: unknown = {}, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/account/google/link", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "u1", role: "USER" });
  mocks.auth.mockResolvedValue({ user: { id: "u1", sessionVersion: 2, authenticatedAt: 123 } });
  mocks.create.mockResolvedValue("test-intent-value");
});
describe("explicit Google linking initialization", () => {
  it("creates rate-limited intent and a protected cookie for the current session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.limit).toHaveBeenCalledWith({
      key: "google-link:u1",
      limit: 5,
      windowSeconds: 600,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      id: "u1",
      sessionVersion: 2,
      authenticatedAt: 123,
    });
    expect(response.headers.get("set-cookie")).toMatch(
      /paiflow.google-link=test-intent-value; Path=\/; .*Max-Age=300; HttpOnly; SameSite=lax/,
    );
  });
  it("rejects cross-origin consent and sandbox sessions before creating an intent", async () => {
    expect((await POST(request({}, "https://attacker.example"))).status).toBe(403);
    mocks.session.mockResolvedValue({ id: "u1", role: "SANDBOX" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects role/audience/body injection and missing session-version claims", async () => {
    expect(GoogleLinkSchema.safeParse({}).success).toBe(true);
    for (const body of [
      { userId: "other" },
      { role: "ADMIN", analyticsAudience: "INTERNAL" },
      null,
      [],
    ])
      expect(GoogleLinkSchema.safeParse(body).success).toBe(false);
    expect((await POST(request({ userId: "other" }))).status).toBe(422);
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("provides usable fresh sign-in instructions instead of sending an authenticated user to login", async () => {
    mocks.create.mockRejectedValue(new GoogleAuthError("link-expired"));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("Sign out and sign in again") },
    });
  });
});
