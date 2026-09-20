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

import { requireDevAuth } from "@/lib/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";

const TOKEN = `pkdev_${"ab".repeat(32)}`;
const OWNER_ID = "11111111-1111-1111-1111-111111111111";

function req(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

function tokenRow(
  overrides: {
    revokedAt?: Date | null;
    user?: { id: string; username: string; role: string; isActive: boolean };
  } = {},
) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    tokenHash: hashApiToken(TOKEN),
    revokedAt: null,
    user: { id: OWNER_ID, username: "owner", role: "USER", isActive: true },
    ...overrides,
  };
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

describe("requireDevAuth", () => {
  it("resolves a live DevApiToken to its owner", async () => {
    mockDb.devApiToken.findUnique.mockResolvedValue(tokenRow());
    await expect(requireDevAuth(req({ "x-dev-api-secret": TOKEN }))).resolves.toEqual({
      user: { id: OWNER_ID, username: "owner", role: "USER" },
    });
  });

  it("accepts the same token as an Authorization bearer", async () => {
    mockDb.devApiToken.findUnique.mockResolvedValue(tokenRow());
    const { user } = await requireDevAuth(req({ authorization: `Bearer ${TOKEN}` }));
    expect(user.id).toBe(OWNER_ID);
  });

  // The regression test for #247: an arbitrary header value is no longer a
  // credential in its own right. It misses the token lookup and falls through
  // to the session rung, which has nobody signed in.
  it("refuses an x-dev-api-secret value that is not a live token", async () => {
    await expectCode(
      requireDevAuth(req({ "x-dev-api-secret": "shared-dev-secret-value" })),
      "UNAUTHENTICATED",
    );
    expect(mockAuth).toHaveBeenCalled();
  });

  it("falls back to the session when no header is present", async () => {
    signedIn("ADMIN");
    const { user } = await requireDevAuth(req());
    expect(user).toEqual({ id: OWNER_ID, username: "owner", role: "ADMIN" });
  });

  it("refuses a revoked token and an inactive owner", async () => {
    mockDb.devApiToken.findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    await expectCode(requireDevAuth(req({ "x-dev-api-secret": TOKEN })), "UNAUTHENTICATED");

    mockDb.devApiToken.findUnique.mockResolvedValue(
      tokenRow({ user: { id: OWNER_ID, username: "owner", role: "USER", isActive: false } }),
    );
    await expectCode(requireDevAuth(req({ "x-dev-api-secret": TOKEN })), "UNAUTHENTICATED");
  });

  // A SANDBOX identity is mintable by anyone; these routes sign with the
  // relayer key, so neither rung may hand one back.
  it("refuses a SANDBOX owner on the token rung with FORBIDDEN", async () => {
    mockDb.devApiToken.findUnique.mockResolvedValue(
      tokenRow({ user: { id: OWNER_ID, username: "sandbox", role: "SANDBOX", isActive: true } }),
    );
    await expectCode(requireDevAuth(req({ "x-dev-api-secret": TOKEN })), "FORBIDDEN");
    // FORBIDDEN is not UNAUTHENTICATED, so it must not fall through to a session.
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("refuses a SANDBOX session on the fallback rung with FORBIDDEN", async () => {
    signedIn("SANDBOX");
    await expectCode(requireDevAuth(req()), "FORBIDDEN");
  });

  // #519 made sessions endable by bumping User.sessionVersion. The dev
  // endpoints reach the session through the same getSessionUser(), so a
  // revoked session must not keep mutating deployed contracts.
  it("refuses a session whose sessionVersion has been bumped", async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID, username: "owner", sessionVersion: 0 } });
    mockDb.user.findUnique.mockResolvedValue({ isActive: true, role: "USER", sessionVersion: 1 });
    await expectCode(requireDevAuth(req()), "UNAUTHENTICATED");
  });
});
