import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createGoogleLinkIntent,
  googleAdapter,
  googleLinkHash,
  GoogleProfileSchema,
  recentGoogleAuthentication,
  resolveGoogleUser,
} from "@/lib/auth/google";
import { analyticsContext } from "@/lib/analytics/context";
import { eventProperties } from "@/lib/analytics/event-policy";
import { CreateAnalyticsAccountSchema } from "@/lib/analytics/account-schema";

const uuidControl = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock("node:crypto", async (original) => {
  const crypto = await original<typeof import("node:crypto")>();
  return { ...crypto, randomUUID: () => uuidControl.values.shift() ?? crypto.randomUUID() };
});
const config = vi.hoisted(() => ({ GOOGLE_AUTH_ENABLED: true, ALLOW_GOOGLE_REGISTRATION: true }));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return { ...module, env: () => ({ ...module.env(), ...config }) };
});
import {
  createGoogleSignupCode,
  createGoogleSignupIntent,
  signupHash,
} from "@/lib/auth/google-signup";
const codeIds: string[] = [];
async function signupGrant() {
  const code = await createGoogleSignupCode({ label: "OAuth integration test", days: 1 });
  codeIds.push(code.id);
  return createGoogleSignupIntent({ code: code.code });
}
const prefix = `oauth862-${randomUUID()}`;
const ids: string[] = [];
function profile(sub = randomUUID(), email = `${sub}@example.com`) {
  return { sub, email, email_verified: true };
}
async function existing(
  extra: {
    analyticsAudience?: "INTERNAL" | "UNCLASSIFIED";
    role?: "USER" | "ADMIN" | "SANDBOX";
    email?: string;
  } = {},
) {
  const user = await db.user.create({
    data: { username: `${prefix}-${randomUUID()}`, passwordHash: "synthetic-test-only", ...extra },
  });
  ids.push(user.id);
  return user;
}
beforeEach(() => {
  uuidControl.values.length = 0;
  config.GOOGLE_AUTH_ENABLED = true;
  config.ALLOW_GOOGLE_REGISTRATION = true;
});
afterAll(async () => {
  await db.googleSignupCode.deleteMany({ where: { id: { in: codeIds } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
});

describe("Google identity persistence (scratch Postgres)", () => {
  it("atomically registers one ordinary external user and returns the same identity", async () => {
    const p = profile();
    const user = await resolveGoogleUser(
      { ...p, role: "ADMIN", analyticsAudience: "INTERNAL" },
      p.sub,
      null,
      undefined,
      await signupGrant(),
    );
    ids.push(user.id);
    expect(user).toMatchObject({
      role: "USER",
      analyticsAudience: "EXTERNAL",
      passwordHash: null,
      email: p.email,
    });
    expect(CreateAnalyticsAccountSchema.shape.username.safeParse(user.username).success).toBe(true);
    expect(user.username).toBe(p.email.split("@")[0]!.slice(0, 32));
    expect(await analyticsContext(user.id)).toMatchObject({
      account_id: user.id,
      audience: "EXTERNAL",
      caller_type: "session",
    });
    config.ALLOW_GOOGLE_REGISTRATION = false;
    expect((await resolveGoogleUser(p, p.sub, null)).id).toBe(user.id);
    expect(
      await googleAdapter.getUserByAccount!({ provider: "google", providerAccountId: p.sub }),
    ).toMatchObject({ id: user.id, username: user.username, role: "USER", sessionVersion: 0 });
    expect(await db.auditLog.count({ where: { userId: user.id, action: "USER_REGISTER" } })).toBe(
      1,
    );
  });
  it("reuses an event code for separate users but never reuses their browser grants", async () => {
    const code = await createGoogleSignupCode({ label: "Reusable event", days: 7 });
    codeIds.push(code.id);
    const firstGrant = await createGoogleSignupIntent({ code: code.code });
    const first = profile();
    const firstUser = await resolveGoogleUser(first, first.sub, null, undefined, firstGrant);
    ids.push(firstUser.id);
    expect(
      await db.googleSignupIntent.findUnique({ where: { tokenHash: signupHash(firstGrant) } }),
    ).toBeNull();
    const second = profile();
    await expect(
      resolveGoogleUser(second, second.sub, null, undefined, firstGrant),
    ).rejects.toThrow("signup-code-required");
    const secondGrant = await createGoogleSignupIntent({ code: code.code });
    const secondUser = await resolveGoogleUser(second, second.sub, null, undefined, secondGrant);
    ids.push(secondUser.id);
    expect(secondUser.id).not.toBe(firstUser.id);
    expect(await db.googleSignupCode.findUnique({ where: { id: code.id } })).toMatchObject({
      disabledAt: null,
    });
  });
  it.each(["disable", "code-expiry", "grant-expiry"])(
    "rejects %s after validation with no partial account",
    async (kind) => {
      const code = await createGoogleSignupCode({ label: "Callback recheck", days: 1 });
      codeIds.push(code.id);
      const grant = await createGoogleSignupIntent({ code: code.code });
      if (kind === "disable")
        await db.googleSignupCode.update({
          where: { id: code.id },
          data: { disabledAt: new Date() },
        });
      if (kind === "code-expiry")
        await db.googleSignupCode.update({
          where: { id: code.id },
          data: { expiresAt: new Date(0) },
        });
      if (kind === "grant-expiry")
        await db.googleSignupIntent.update({
          where: { tokenHash: signupHash(grant) },
          data: { expiresAt: new Date(0) },
        });
      const p = profile();
      await expect(resolveGoogleUser(p, p.sub, null, undefined, grant)).rejects.toThrow(
        "signup-code-required",
      );
      expect(await db.user.count({ where: { email: p.email } })).toBe(0);
      expect(await db.googleIdentity.count({ where: { providerAccountId: p.sub } })).toBe(0);
    },
  );
  it("denies missing or tampered browser grants on direct sign-in while valid grants never override closed registration", async () => {
    const p = profile();
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("signup-code-required");
    await expect(resolveGoogleUser(p, p.sub, null, undefined, "forged-grant")).rejects.toThrow(
      "signup-code-required",
    );
    const grant = await signupGrant();
    config.ALLOW_GOOGLE_REGISTRATION = false;
    await expect(resolveGoogleUser(p, p.sub, null, undefined, grant)).rejects.toThrow(
      "registration-closed",
    );
    expect(await db.user.count({ where: { email: p.email } })).toBe(0);
  });
  it("adds a short suffix to an occupied email prefix without leaving a partial user", async () => {
    const fixed = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      p = profile();
    const occupied = await db.user.create({
      data: {
        username: p.email.split("@")[0]!.slice(0, 32),
        passwordHash: "synthetic-only",
      },
    });
    ids.push(occupied.id);
    uuidControl.values.push(fixed);
    const user = await resolveGoogleUser(p, p.sub, null, undefined, await signupGrant());
    ids.push(user.id);
    expect(user.username).toBe(`${occupied.username.slice(0, 25)}-aaaaaa`);
    expect(await db.user.count({ where: { email: p.email } })).toBe(1);
  });
  it("persists the selected name and keeps it stable when Google's email changes", async () => {
    const p = profile();
    const code = await createGoogleSignupCode({ label: "Editable name", days: 1 });
    codeIds.push(code.id);
    const chosen = `chosen-${randomUUID().slice(0, 12)}`;
    const grant = await createGoogleSignupIntent({ code: code.code, username: chosen });
    const user = await resolveGoogleUser(p, p.sub, null, undefined, grant);
    ids.push(user.id);
    expect(user.username).toBe(chosen);
    expect(
      (await resolveGoogleUser({ ...p, email: "changed@example.com" }, p.sub, null)).username,
    ).toBe(chosen);
  });
  it("registers concurrent distinct identities with the same email prefix without duplicates", async () => {
    const name = `same-${randomUUID().slice(0, 12)}`;
    const a = profile(randomUUID(), `${name}@example.com`);
    const b = profile(randomUUID(), `${name}@example.org`);
    const grants = [await signupGrant(), await signupGrant()];
    const users = await Promise.all(
      [a, b].map((p, i) => resolveGoogleUser(p, p.sub, null, undefined, grants[i])),
    );
    ids.push(...users.map((u) => u.id));
    expect(new Set(users.map((u) => u.username)).size).toBe(2);
    expect(users.some((u) => u.username === name)).toBe(true);
    expect(
      users.every((u) => CreateAnalyticsAccountSchema.shape.username.safeParse(u.username).success),
    ).toBe(true);
  });
  it("throttles validated Google identities without sharing a registration bucket by IP", async () => {
    const p = profile();
    const user = await resolveGoogleUser(p, p.sub, null, undefined, await signupGrant());
    ids.push(user.id);
    for (let i = 1; i < 20; i++) await resolveGoogleUser(p, p.sub, null);
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("rate-limited");
    const q = profile();
    const other = await resolveGoogleUser(q, q.sub, null, undefined, await signupGrant());
    ids.push(other.id);
    expect(other.id).not.toBe(user.id);
    expect(await db.user.count({ where: { email: p.email } })).toBe(1);
  });
  it("concurrent registration of the same sub creates no duplicates or orphans", async () => {
    const p = profile();
    const grant = await signupGrant();
    const results = await Promise.all(
      Array.from({ length: 3 }, () => resolveGoogleUser(p, p.sub, null, undefined, grant)),
    );
    ids.push(results[0]!.id);
    expect(new Set(results.map((u) => u.id)).size).toBe(1);
    expect(await db.user.count({ where: { email: p.email } })).toBe(1);
    expect(await db.googleIdentity.count({ where: { providerAccountId: p.sub } })).toBe(1);
  });
  it("concurrent different subs with the same email never auto-merge or orphan users", async () => {
    const email = `${randomUUID()}@example.com`;
    const p = profile(randomUUID(), email),
      q = profile(randomUUID(), email);
    const results = await Promise.allSettled([
      resolveGoogleUser(p, p.sub, null, undefined, await signupGrant()),
      resolveGoogleUser(q, q.sub, null, undefined, await signupGrant()),
    ]);
    for (const result of results) if (result.status === "fulfilled") ids.push(result.value.id);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(
      await db.googleIdentity.count({ where: { providerAccountId: { in: [p.sub, q.sub] } } }),
    ).toBe(1);
  });
  it("enforces separate availability and registration gates on callback writes", async () => {
    const p = profile();
    config.ALLOW_GOOGLE_REGISTRATION = false;
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("registration-closed");
    config.GOOGLE_AUTH_ENABLED = false;
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("unavailable");
    expect(await db.user.count({ where: { email: p.email } })).toBe(0);
  });
  it("detects legacy mixed-case email owners without changing their address", async () => {
    const address = `${randomUUID()}@Example.COM`,
      owner = await existing({ email: address }),
      p = profile(randomUUID(), address.toLowerCase());
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("email-conflict");
    const user = await existing(),
      session = { id: user.id, sessionVersion: 0, authenticatedAt: Date.now() },
      token = await createGoogleLinkIntent(session);
    await expect(resolveGoogleUser(p, p.sub, session, token)).rejects.toThrow("email-conflict");
    expect((await db.user.findUnique({ where: { id: owner.id } }))!.email).toBe(address);
    expect(await db.googleIdentity.count({ where: { userId: user.id } })).toBe(0);
  });
  it("does not merge by email or implicitly link a signed-in user", async () => {
    const p = profile();
    const user = await existing({ email: p.email });
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("email-conflict");
    await expect(resolveGoogleUser(p, p.sub, { id: user.id, sessionVersion: 0 })).rejects.toThrow(
      "link-required",
    );
    await expect(
      googleAdapter.createUser!({ id: "unused", email: p.email, emailVerified: null }),
    ).rejects.toThrow("link-required");
    await expect(
      googleAdapter.linkAccount!({
        provider: "google",
        providerAccountId: p.sub,
        userId: user.id,
        type: "oidc",
      }),
    ).rejects.toThrow("link-required");
  });
  it("links only with recent, single-use consent while retaining role, audience and email", async () => {
    const user = await existing({
      role: "ADMIN",
      analyticsAudience: "INTERNAL",
      email: `${randomUUID()}@example.com`,
    });
    const session = { id: user.id, sessionVersion: 0, authenticatedAt: Date.now() };
    const raw = await createGoogleLinkIntent(session),
      p = profile();
    expect(await db.googleLinkIntent.findUnique({ where: { tokenHash: raw } })).toBeNull();
    expect(
      await db.googleLinkIntent.findUnique({ where: { tokenHash: googleLinkHash(raw) } }),
    ).not.toBeNull();
    config.ALLOW_GOOGLE_REGISTRATION = false;
    expect(await resolveGoogleUser(p, p.sub, session, raw)).toMatchObject({
      id: user.id,
      role: "ADMIN",
      analyticsAudience: "INTERNAL",
      email: user.email,
    });
    await expect(resolveGoogleUser(p, p.sub, session, raw)).rejects.toThrow("link-expired");
    expect(
      await db.auditLog.count({ where: { userId: user.id, action: "USER_GOOGLE_LINK" } }),
    ).toBe(1);
  });
  it("consumes parallel callbacks once and rejects an expired database intent", async () => {
    const user = await existing(),
      p = profile(),
      session = { id: user.id, sessionVersion: 0, authenticatedAt: Date.now() };
    const raw = await createGoogleLinkIntent(session);
    const results = await Promise.allSettled([
      resolveGoogleUser(p, p.sub, session, raw),
      resolveGoogleUser(p, p.sub, session, raw),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.googleIdentity.count({ where: { userId: user.id } })).toBe(1);
    await expect(createGoogleLinkIntent(session)).rejects.toThrow("provider-conflict");
    const other = await existing(),
      otherSession = { ...session, id: other.id },
      otherRaw = await createGoogleLinkIntent(otherSession);
    await db.googleLinkIntent.update({
      where: { tokenHash: googleLinkHash(otherRaw) },
      data: { expiresAt: new Date(0) },
    });
    const q = profile();
    await expect(resolveGoogleUser(q, q.sub, otherSession, otherRaw)).rejects.toThrow(
      "link-expired",
    );
    expect(await db.googleIdentity.count({ where: { userId: other.id } })).toBe(0);
  });
  it("refuses stale, logged-out, different-user and revoked linking grants", async () => {
    const user = await existing(),
      other = await existing(),
      p = profile();
    const session = { id: user.id, sessionVersion: 0, authenticatedAt: Date.now() };
    await expect(
      createGoogleLinkIntent({ ...session, authenticatedAt: Date.now() - 300_001 }),
    ).rejects.toThrow("link-expired");
    const raw = await createGoogleLinkIntent(session);
    await expect(resolveGoogleUser(p, p.sub, null, raw)).rejects.toThrow("link-expired");
    await expect(resolveGoogleUser(p, p.sub, { ...session, id: other.id }, raw)).rejects.toThrow(
      "link-expired",
    );
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: 1 } });
    await expect(resolveGoogleUser(p, p.sub, session, raw)).rejects.toThrow("account-disabled");
    expect(await db.googleIdentity.count({ where: { userId: user.id } })).toBe(0);
  });
  it("refuses provider ownership/email collisions, sandbox and deactivated identities", async () => {
    const p = profile(),
      registered = await resolveGoogleUser(p, p.sub, null, undefined, await signupGrant());
    ids.push(registered.id);
    const user = await existing(),
      session = { id: user.id, sessionVersion: 0, authenticatedAt: Date.now() },
      raw = await createGoogleLinkIntent(session);
    await expect(resolveGoogleUser(p, p.sub, session, raw)).rejects.toThrow("provider-conflict");
    const emailOwner = await existing({ email: `${randomUUID()}@example.com` }),
      conflict = profile(randomUUID(), emailOwner.email!);
    await expect(resolveGoogleUser(conflict, conflict.sub, session, raw)).rejects.toThrow(
      "email-conflict",
    );
    const sandbox = await existing({ role: "SANDBOX" });
    await expect(createGoogleLinkIntent({ ...session, id: sandbox.id })).rejects.toThrow(
      "account-disabled",
    );
    await db.user.update({ where: { id: registered.id }, data: { isActive: false } });
    await expect(resolveGoogleUser(p, p.sub, null)).rejects.toThrow("account-disabled");
    await expect(
      googleAdapter.getUserByAccount!({ provider: "google", providerAccountId: p.sub }),
    ).rejects.toThrow("account-disabled");
  });
});

describe("Google boundary validation", () => {
  it("requires verified email and matching stable provider sub", async () => {
    for (const p of [
      { sub: "", email: "a@example.com", email_verified: true },
      { sub: "abc", email: "bad", email_verified: true },
      { sub: "abc", email: "a@example.com", email_verified: false },
    ])
      expect(GoogleProfileSchema.safeParse(p).success).toBe(false);
    const p = profile();
    await expect(resolveGoogleUser(p, "different-sub", null)).rejects.toThrow("provider-conflict");
  });
  it("accepts only a fixed recent authentication timestamp and event-specific Google analytics method", () => {
    expect(recentGoogleAuthentication(undefined)).toBe(false);
    expect(recentGoogleAuthentication(Date.now() + 1000)).toBe(false);
    expect(recentGoogleAuthentication(NaN)).toBe(false);
    expect(recentGoogleAuthentication(Date.now())).toBe(true);
    expect(eventProperties("login_succeeded", { method: "google" })).toEqual({ method: "google" });
    expect(eventProperties("api_request_completed", { method: "google" })).toEqual({});
    expect(eventProperties("api_request_completed", { method: "POST" })).toEqual({
      method: "POST",
    });
    expect(eventProperties("login_succeeded", { method: "POST" })).toEqual({});
  });
});
