/**
 * `callbacks.jwt` and `callbacks.session` carry `User.sessionVersion` from
 * sign-in to getSessionUser() (#519).
 *
 * Two things here fail silently if they regress. The version has to be the one
 * authorize() returned, or every login mints a token that is refused on its
 * first request. And Auth.js calls `jwt` again on the rolling refresh with no
 * `user`: that call has to keep the value it was given, because a refresh that
 * dropped it would read as version 0 and resurrect a revoked session on any
 * account that had never been bumped past it.
 */
import { describe, it, expect } from "vitest";
import { authConfig } from "@/auth.config";

type JwtCallback = NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>;
type SessionCallback = NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>;
type Token = Record<string, unknown>;

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  username: "owner",
  role: "USER",
  sessionVersion: 3,
};

async function jwt(token: Token, user?: typeof USER): Promise<Token> {
  const fn = authConfig.callbacks?.jwt;
  if (!fn) throw new Error("authConfig.callbacks.jwt is not defined");
  const out = await fn({ token, user } as unknown as Parameters<JwtCallback>[0]);
  if (!out) throw new Error("jwt callback returned no token");
  return out as Token;
}

async function sessionUser(token: Token): Promise<Record<string, unknown>> {
  const fn = authConfig.callbacks?.session;
  if (!fn) throw new Error("authConfig.callbacks.session is not defined");
  const out = await fn({
    session: { user: {}, expires: "2026-12-31T00:00:00.000Z" },
    token,
  } as unknown as Parameters<SessionCallback>[0]);
  return (out as unknown as { user: Record<string, unknown> }).user;
}

describe("auth jwt callback", () => {
  it("copies the user's sessionVersion onto the token at sign-in", async () => {
    const token = await jwt({}, USER);
    expect(token).toMatchObject({
      id: USER.id,
      username: "owner",
      role: "USER",
      sessionVersion: 3,
    });
  });

  it("stores version 0 as 0, not as absent", async () => {
    const token = await jwt({}, { ...USER, sessionVersion: 0 });
    expect(token.sessionVersion).toBe(0);
  });

  it("keeps the version on a rolling refresh, where user is undefined", async () => {
    const signedIn = await jwt({}, USER);
    const refreshed = await jwt({ ...signedIn });
    expect(refreshed.sessionVersion).toBe(3);
    expect(refreshed.id).toBe(USER.id);
  });

  it("leaves a token minted before the claim existed without one", async () => {
    const legacy = { id: USER.id, username: "owner", role: "USER" };
    const refreshed = await jwt({ ...legacy });
    expect(refreshed).not.toHaveProperty("sessionVersion");
  });
});

describe("auth session callback", () => {
  it("hands the token's version to the session", async () => {
    const user = await sessionUser(await jwt({}, USER));
    expect(user.sessionVersion).toBe(3);
    expect(user.id).toBe(USER.id);
  });

  it("does not invent a version for a legacy token", async () => {
    const user = await sessionUser({ id: USER.id, username: "owner", role: "USER" });
    expect(user.sessionVersion).toBeUndefined();
  });
});
