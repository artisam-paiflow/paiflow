import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const { mockDb, mockAuth } = vi.hoisted(() => ({
  mockDb: {
    devApiToken: { findUnique: vi.fn(), update: vi.fn(() => ({ catch: () => {} })) },
    user: { findUnique: vi.fn() },
  },
  mockAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: mockAuth, signIn: vi.fn(), signOut: vi.fn() }),
}));
import { requirePayrollSession } from "@/lib/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";
const TOKEN = `pkdev_${"ab".repeat(32)}`;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
function req(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}
// getSessionUser() takes the role from the User row and refuses a token whose
// sessionVersion has moved on, so a session fixture is a token plus its row.
function signedIn(role: string) {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID, username: "owner", sessionVersion: 0 } });
  mockDb.user.findUnique.mockResolvedValue({ isActive: true, role, sessionVersion: 0 });
}
async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === code);
}
beforeEach(() => {
  vi.clearAllMocks();
  mockDb.devApiToken.findUnique.mockResolvedValue(null);
  mockDb.devApiToken.update.mockReturnValue({ catch: () => {} });
  mockAuth.mockResolvedValue(null);
  mockDb.user.findUnique.mockResolvedValue(null);
});
describe("owner payroll session", () => {
  it("rejects a legacy machine token without a session", async () => {
    await expectCode(requirePayrollSession(req({ "x-dev-api-secret": TOKEN })), "UNAUTHENTICATED");
    expect(mockDb.devApiToken.findUnique).not.toHaveBeenCalled();
  });
  it("accepts the current owner session", async () => {
    signedIn("USER");
    await expect(requirePayrollSession(req())).resolves.toMatchObject({ user: { id: OWNER_ID } });
  });
  it("rejects sandbox sessions even when authenticated", async () => {
    signedIn("SANDBOX");
    await expectCode(requirePayrollSession(req()), "FORBIDDEN");
  });
  it("rejects revoked sessions", async () => {
    signedIn("USER");
    mockDb.user.findUnique.mockResolvedValue({ isActive: true, role: "USER", sessionVersion: 1 });
    await expectCode(requirePayrollSession(req()), "UNAUTHENTICATED");
  });
});
