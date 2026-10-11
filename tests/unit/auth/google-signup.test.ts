import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  tx: {
    googleSignupCode: { create: vi.fn(), findUnique: vi.fn() },
    googleSignupIntent: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    googleIdentity: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  config: { GOOGLE_AUTH_ENABLED: true, ALLOW_GOOGLE_REGISTRATION: true },
}));
vi.mock("@/lib/db", () => ({
  db: { ...h.tx, $transaction: async (fn: (tx: typeof h.tx) => unknown) => fn(h.tx) },
}));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return { ...module, env: () => ({ ...module.env(), ...h.config }) };
});
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
import {
  createGoogleSignupCode,
  createGoogleSignupIntent,
  signupHash,
  signupCodeStatus,
  GOOGLE_SIGNUP_INTENT_MS,
} from "@/lib/auth/google-signup";
import { resolveGoogleUser } from "@/lib/auth/google";

const profile = { sub: "new-google-sub", email: "invited@example.com", email_verified: true };
function validCode() {
  return { id: "code-id", disabledAt: null, expiresAt: new Date(Date.now() + 86_400_000) };
}
function validIntent() {
  return {
    id: "intent-id",
    expiresAt: new Date(Date.now() + GOOGLE_SIGNUP_INTENT_MS),
    code: validCode(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.config.GOOGLE_AUTH_ENABLED = true;
  h.config.ALLOW_GOOGLE_REGISTRATION = true;
  h.tx.googleSignupCode.findUnique.mockResolvedValue(validCode());
  h.tx.googleSignupCode.create.mockImplementation(async ({ data }) => ({ id: "code-id", ...data }));
  h.tx.googleSignupIntent.findUnique.mockResolvedValue(validIntent());
  h.tx.googleSignupIntent.deleteMany.mockResolvedValue({ count: 1 });
  h.tx.googleIdentity.findUnique.mockResolvedValue(null);
  h.tx.user.findFirst.mockResolvedValue(null);
  h.tx.user.create.mockResolvedValue({ id: "new-user", role: "USER" });
});
describe("Google reusable signup invitations", () => {
  it.each([1, 7, 30])("creates a private random code expiring after %i days", async (days) => {
    const before = Date.now();
    const result = await createGoogleSignupCode({ label: "Hackathon", days });
    expect(result.code).toMatch(/^[0-9a-f]{32}$/);
    const data = h.tx.googleSignupCode.create.mock.calls[0]![0].data;
    expect(data.codeHash).toBe(signupHash(result.code));
    expect(data).not.toHaveProperty("code");
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + days * 86_400_000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + days * 86_400_000);
  });
  it("rejects unsupported expiry choices", async () => {
    await expect(createGoogleSignupCode({ label: "Hackathon", days: 2 })).rejects.toThrow();
    expect(h.tx.googleSignupCode.create).not.toHaveBeenCalled();
  });
  it("reuses the same invitation while issuing distinct single-use browser grants", async () => {
    const a = await createGoogleSignupIntent({ code: "shared-code" });
    const b = await createGoogleSignupIntent({ code: "shared-code" });
    expect(a).not.toBe(b);
    expect(h.tx.googleSignupCode.findUnique).toHaveBeenCalledWith({
      where: { codeHash: signupHash("shared-code") },
    });
    expect(h.tx.googleSignupIntent.create).toHaveBeenCalledTimes(2);
    expect(h.tx.googleSignupIntent.create.mock.calls[0]![0].data.tokenHash).toBe(signupHash(a));
    expect(h.tx.googleSignupCode.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "unknown", "expired", "disabled"])(
    "rejects %s codes before OAuth",
    async (kind) => {
      if (kind === "unknown") h.tx.googleSignupCode.findUnique.mockResolvedValue(null);
      if (kind === "expired")
        h.tx.googleSignupCode.findUnique.mockResolvedValue({
          ...validCode(),
          expiresAt: new Date(0),
        });
      if (kind === "disabled")
        h.tx.googleSignupCode.findUnique.mockResolvedValue({
          ...validCode(),
          disabledAt: new Date(),
        });
      await expect(
        createGoogleSignupIntent({ code: kind === "missing" ? "" : "test" }),
      ).rejects.toThrow();
      expect(h.tx.googleSignupIntent.create).not.toHaveBeenCalled();
    },
  );
  it("treats exact expiry as expired and caps intent lifetime to invitation expiry", async () => {
    const now = new Date();
    expect(signupCodeStatus({ disabledAt: null, expiresAt: now }, now)).toBe("Expired");
    const expiresAt = new Date(Date.now() + 1000);
    h.tx.googleSignupCode.findUnique.mockResolvedValue({ ...validCode(), expiresAt });
    await createGoogleSignupIntent({ code: "test" });
    expect(h.tx.googleSignupIntent.create.mock.calls[0]![0].data.expiresAt).toEqual(expiresAt);
  });
  it("denies new users arriving directly through sign in without a grant", async () => {
    await expect(resolveGoogleUser(profile, profile.sub, null)).rejects.toThrow(
      "signup-code-required",
    );
    expect(h.tx.user.create).not.toHaveBeenCalled();
  });
  it.each(["tampered", "expired-intent", "expired-code", "disabled-code", "replayed"])(
    "blocks %s state before account creation",
    async (kind) => {
      const intent = validIntent();
      if (kind === "tampered") h.tx.googleSignupIntent.findUnique.mockResolvedValue(null);
      if (kind === "expired-intent") intent.expiresAt = new Date(0);
      if (kind === "expired-code") intent.code.expiresAt = new Date(0);
      if (kind === "disabled-code") Object.assign(intent.code, { disabledAt: new Date() });
      if (kind !== "tampered") h.tx.googleSignupIntent.findUnique.mockResolvedValue(intent);
      if (kind === "replayed") h.tx.googleSignupIntent.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        resolveGoogleUser(profile, profile.sub, null, undefined, "grant-token"),
      ).rejects.toThrow("signup-code-required");
      expect(h.tx.user.create).not.toHaveBeenCalled();
    },
  );
  it("consumes authorization before provisioning while preserving ordinary role and audience", async () => {
    await resolveGoogleUser(profile, profile.sub, null, undefined, "grant-token");
    expect(h.tx.googleSignupIntent.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: signupHash("grant-token") },
      include: { code: true },
    });
    expect(h.tx.googleSignupIntent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.tx.user.create.mock.invocationCallOrder[0]!,
    );
    expect(h.tx.user.create.mock.calls[0]![0].data).toMatchObject({
      role: "USER",
      analyticsAudience: "EXTERNAL",
      passwordHash: null,
    });
  });
  it("allows existing linked users without codes, even with registration closed", async () => {
    const user = { id: "existing", isActive: true, role: "USER" };
    h.tx.googleIdentity.findUnique.mockResolvedValue({ user, userId: user.id });
    h.config.ALLOW_GOOGLE_REGISTRATION = false;
    expect(await resolveGoogleUser(profile, profile.sub, null)).toEqual(user);
    expect(h.tx.googleSignupIntent.findUnique).not.toHaveBeenCalled();
  });
  it("a valid code never overrides closed Google registration", async () => {
    h.config.ALLOW_GOOGLE_REGISTRATION = false;
    await expect(createGoogleSignupIntent({ code: "valid" })).rejects.toThrow("closed");
    await expect(
      resolveGoogleUser(profile, profile.sub, null, undefined, "valid-grant"),
    ).rejects.toThrow("registration-closed");
    expect(h.tx.user.create).not.toHaveBeenCalled();
  });
});
