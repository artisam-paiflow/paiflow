import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  hash: vi.fn(),
  verify: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ id: "u1", username: "localuser", role: "USER" }),
  hashPassword: mocks.hash,
  verifyPassword: mocks.verify,
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => {},
  rateLimit: async () => ({ ok: true }),
  clientIp: () => "127.0.0.1",
  rateLimitedError: vi.fn(),
}));
vi.mock("@/lib/email/password-reset", () => ({ sendPasswordResetEmail: mocks.send }));
vi.mock("@/lib/hibp", () => ({ pwnedCount: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { POST as change } from "@/app/api/account/password/route";
import { POST as requestReset } from "@/app/api/auth/password-reset/route";
import { POST as completeReset } from "@/app/api/auth/new-password/route";
function request(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.user.findUnique.mockResolvedValue({
    id: "u1",
    username: "localuser",
    email: "verified@example.com",
    passwordHash: null,
    isActive: true,
  });
});
describe("Google-only accounts cannot silently enroll local passwords", () => {
  it("blocks password change on the server", async () => {
    const response = await change(
      request("/api/account/password", {
        currentPassword: "some-password",
        newPassword: "new-secret-for-testing",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });
  it("returns the generic recovery response but issues no Google-only reset token", async () => {
    const response = await requestReset(
      request("/api/auth/password-reset", { email: "verified@example.com" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { message: expect.stringContaining("If an account exists") },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects even a preexisting valid email-reset token for a Google-only user", async () => {
    mocks.db.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "u1", isActive: true, username: "localuser", passwordHash: null },
    });
    const response = await completeReset(
      request("/api/auth/new-password", {
        token: "a".repeat(40),
        password: "new-secret-for-testing",
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
