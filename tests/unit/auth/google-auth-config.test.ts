import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ticket: vi.fn(),
  auth: vi.fn(),
  resolve: vi.fn(),
  identity: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  audit: vi.fn(),
  capture: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("@/lib/passkey/challenges", () => ({ popChallenge: h.ticket }));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: h.auth, signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: h.cookieGet, set: h.cookieSet }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: h.user, update: h.update, updateMany: h.update },
    googleIdentity: { findUnique: h.identity },
  },
}));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return {
    ...module,
    env: () => ({
      ...module.env(),
      GOOGLE_AUTH_ENABLED: true,
      ALLOW_GOOGLE_REGISTRATION: true,
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      AUTH_URL: "https://app.example",
    }),
  };
});
vi.mock("@/lib/auth/google", async (original) => {
  const module = await original<typeof import("@/lib/auth/google")>();
  return { ...module, resolveGoogleUser: h.resolve };
});
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: h.capture }));
vi.mock("@/lib/log", () => ({ log: { error: h.logError, warn: h.logWarn } }));

import { fullAuthConfig, hashPassword } from "@/lib/auth";
import { GOOGLE_LINK_COOKIE, GoogleAuthError } from "@/lib/auth/google";

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  username: "google_customer",
  email: "customer@example.com",
  passwordHash: null,
  role: "USER",
  analyticsAudience: "EXTERNAL",
  isActive: true,
  sessionVersion: 4,
};
const ACCOUNT = { provider: "google", providerAccountId: "stable-google-sub", type: "oidc" };
const PROFILE = { sub: ACCOUNT.providerAccountId, email: USER.email, email_verified: true };
type SignInInput = Parameters<typeof fullAuthConfig.callbacks.signIn>[0];
type JwtInput = Parameters<typeof fullAuthConfig.callbacks.jwt>[0];

function googleSignIn() {
  return fullAuthConfig.callbacks.signIn({
    user: { id: USER.id, email: USER.email },
    account: ACCOUNT,
    profile: PROFILE,
  } as SignInInput);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(null);
  h.cookieGet.mockReturnValue(undefined);
  h.identity.mockResolvedValue(null);
  h.user.mockResolvedValue(USER);
  h.update.mockResolvedValue({ count: 1 });
  h.resolve.mockResolvedValue(USER);
  h.capture.mockResolvedValue(undefined);
});

describe("Google Auth.js callback integration", () => {
  it("retains Credentials password login and passkey tickets for Google-only users", async () => {
    const credentials = fullAuthConfig.providers.find((provider) => provider.id === "credentials");
    if (!credentials || credentials.type !== "credentials")
      throw new Error("Credentials provider missing");
    // Provider factory stores caller options until Auth.js normalizes it.
    const authorize = (
      credentials as typeof credentials & {
        options: { authorize: typeof credentials.authorize };
      }
    ).options.authorize;
    const password = "synthetic-test-only-password";
    const hash = await hashPassword(password);
    h.user.mockResolvedValue({ ...USER, passwordHash: hash, failedLogins: 0, lockedUntil: null });
    expect(
      await authorize({ username: USER.username, password }, new Request("https://app.example")),
    ).toMatchObject({ id: USER.id, role: "USER", sessionVersion: 4 });
    expect(h.capture).toHaveBeenCalledWith(USER.id, "login_succeeded", { method: "password" });
    h.user.mockResolvedValue(USER);
    h.ticket.mockResolvedValue(USER.id);
    expect(
      await authorize(
        { passkeyTicket: "single-use-test-ticket" } as unknown as Parameters<typeof authorize>[0],
        new Request("https://app.example"),
      ),
    ).toMatchObject({ id: USER.id, role: "USER", sessionVersion: 4 });
    expect(h.ticket).toHaveBeenCalledWith("ticket", "single-use-test-ticket");
    expect(h.capture).toHaveBeenCalledWith(USER.id, "login_succeeded", { method: "ticket" });
  });
  it("makes the provisioned Paiflow user available to the second adapter lookup", async () => {
    const adapter = fullAuthConfig.adapter;
    const key = { provider: ACCOUNT.provider, providerAccountId: ACCOUNT.providerAccountId };
    expect(await adapter.getUserByAccount!(key)).toBeNull();
    h.resolve.mockImplementationOnce(async () => {
      h.identity.mockResolvedValue({ user: USER, userId: USER.id });
      return USER;
    });
    expect(await googleSignIn()).toBe(true);
    expect(h.resolve).toHaveBeenCalledWith(
      PROFILE,
      ACCOUNT.providerAccountId,
      null,
      undefined,
      undefined,
    );
    const persisted = await adapter.getUserByAccount!(key);
    expect(persisted).toMatchObject({
      id: USER.id,
      username: USER.username,
      role: "USER",
      sessionVersion: 4,
    });
    const token = await fullAuthConfig.callbacks.jwt({
      token: {},
      user: persisted,
      account: ACCOUNT,
    } as JwtInput);
    expect(token).toMatchObject({
      id: USER.id,
      username: USER.username,
      role: "USER",
      sessionVersion: 4,
    });
  });

  it("passes explicit linking consent and authentication claims, then clears the browser grant", async () => {
    const authenticatedAt = Date.now();
    h.auth.mockResolvedValue({ user: { id: USER.id, sessionVersion: 4, authenticatedAt } });
    h.cookieGet.mockImplementation((name) =>
      name === GOOGLE_LINK_COOKIE ? { value: "one-use-link-grant" } : undefined,
    );
    expect(await googleSignIn()).toBe(true);
    expect(h.cookieGet).toHaveBeenCalledWith(GOOGLE_LINK_COOKIE);
    expect(h.cookieSet).toHaveBeenCalledWith(GOOGLE_LINK_COOKIE, "", {
      path: "/",
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });
    expect(h.resolve).toHaveBeenCalledWith(
      PROFILE,
      ACCOUNT.providerAccountId,
      { id: USER.id, sessionVersion: 4, authenticatedAt },
      "one-use-link-grant",
      undefined,
    );
  });

  it("maps rejected linking to a fixed account error and clears consent on failure", async () => {
    h.auth.mockResolvedValue({
      user: { id: USER.id, sessionVersion: 4, authenticatedAt: Date.now() },
    });
    h.cookieGet.mockReturnValue({ value: "expired-grant" });
    h.resolve.mockRejectedValueOnce(new GoogleAuthError("link-expired"));
    expect(await googleSignIn()).toBe("https://app.example/account?googleError=link-expired");
    expect(h.cookieSet).toHaveBeenCalledWith(
      GOOGLE_LINK_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true }),
    );
  });

  it("expires production linking cookies with the Secure attribute required by the host prefix", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      h.cookieGet.mockReturnValue({ value: "one-use-grant" });
      expect(await googleSignIn()).toBe(true);
      expect(h.cookieSet).toHaveBeenCalledWith(GOOGLE_LINK_COOKIE, "", {
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 0,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not provision accounts from authenticated cookies missing Paiflow version claims", async () => {
    h.auth.mockResolvedValue({ user: { id: USER.id } });
    expect(await googleSignIn()).toBe("https://app.example/auth/error?error=account-disabled");
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("maps closed registration to the public error page and does not treat Credentials as Google", async () => {
    h.resolve.mockRejectedValueOnce(new GoogleAuthError("registration-closed"));
    expect(await googleSignIn()).toBe("https://app.example/auth/error?error=registration-closed");
    h.resolve.mockClear();
    expect(
      await fullAuthConfig.callbacks.signIn({
        account: { provider: "credentials" },
      } as SignInInput),
    ).toBe(true);
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...USER, isActive: false },
    { ...USER, role: "SANDBOX" },
    { ...USER, sessionVersion: 5 },
  ])("refuses JWT issuance when the persisted account changed during callback: %j", async (row) => {
    h.user.mockResolvedValue(row);
    expect(
      await fullAuthConfig.callbacks.jwt({ token: {}, user: USER, account: ACCOUNT } as JwtInput),
    ).toBeNull();
  });

  it("keeps authentication freshness fixed during JWT refresh", async () => {
    const token = { id: USER.id, sessionVersion: 4, authenticatedAt: 12345 };
    expect(await fullAuthConfig.callbacks.jwt({ token } as unknown as JwtInput)).toMatchObject(
      token,
    );
    expect(h.user).not.toHaveBeenCalled();
  });

  it("records Google login without leaking provider token metadata into audit or analytics", async () => {
    const input = {
      user: USER,
      account: { ...ACCOUNT, access_token: "private-access-token", id_token: "private-id-token" },
    } as Parameters<typeof fullAuthConfig.events.signIn>[0];
    await fullAuthConfig.events.signIn(input);
    expect(h.update).toHaveBeenCalledWith({
      where: {
        id: USER.id,
        isActive: true,
        role: { not: "SANDBOX" },
        sessionVersion: USER.sessionVersion,
      },
      data: {
        lastLoginAt: expect.any(Date),
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    expect(h.audit).toHaveBeenCalledWith({
      action: "USER_LOGIN",
      userId: USER.id,
      metadata: { method: "google" },
    });
    expect(h.capture).toHaveBeenCalledWith(USER.id, "login_succeeded", { method: "google" });
    const calls = JSON.stringify([h.audit.mock.calls, h.capture.mock.calls]);
    expect(calls).not.toContain("private-access-token");
    expect(calls).not.toContain("private-id-token");
  });

  it("does not report successful Google login after a concurrent revocation or deactivation", async () => {
    h.update.mockResolvedValue({ count: 0 });
    await fullAuthConfig.events.signIn({ user: USER, account: ACCOUNT } as Parameters<
      typeof fullAuthConfig.events.signIn
    >[0]);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("suppresses sensitive Auth.js error/debug payloads", () => {
    const logger = fullAuthConfig.logger;
    const payload = { code: "private-code", cause: { access_token: "private-token" } };
    (logger.error as (...args: unknown[]) => void)(payload);
    (logger.warn as (...args: unknown[]) => void)(payload);
    (logger.debug as (...args: unknown[]) => void)("authorization result", payload);
    expect(h.logError).toHaveBeenCalledWith("Authentication request failed");
    expect(h.logWarn).toHaveBeenCalledWith("Authentication configuration warning");
    expect(JSON.stringify([h.logError.mock.calls, h.logWarn.mock.calls])).not.toContain("private-");
  });
});
