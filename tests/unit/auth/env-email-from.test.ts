import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/env` memoizes the parsed result on first call. We `resetModules()`
// before each case so a fresh import re-parses `process.env`.
async function loadEnv() {
  const mod = await import("@/lib/env");
  return mod.env;
}

const REQUIRED_MIN: Record<string, string> = {
  AUTH_SECRET: "x".repeat(48),
  DATABASE_URL: "postgresql://user:pw@localhost:5432/db?schema=public",
};

describe("env() EMAIL_FROM handling", () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
    // Clean slate — keep only keys we need for env() to validate.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("npm_") || k === "NODE_ENV" || k === "PATH" || k === "HOME") continue;
      delete process.env[k];
    }
    Object.assign(process.env, REQUIRED_MIN);
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, snapshot);
  });

  it("does not throw when EMAIL_FROM is unset", async () => {
    const env = await loadEnv();
    expect(() => env()).not.toThrow();
    expect(env().EMAIL_FROM).toMatch(/onboarding@resend\.dev/);
  });

  it("does not throw when EMAIL_FROM is the empty string (.env.example default)", async () => {
    process.env.EMAIL_FROM = "";
    const env = await loadEnv();
    expect(() => env()).not.toThrow();
    expect(env().EMAIL_FROM).toMatch(/onboarding@resend\.dev/);
  });

  it("honors a configured EMAIL_FROM", async () => {
    process.env.EMAIL_FROM = "Custom <no-reply@example.com>";
    const env = await loadEnv();
    expect(env().EMAIL_FROM).toBe("Custom <no-reply@example.com>");
  });
});
