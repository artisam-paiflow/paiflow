import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("createAiAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-auth-secret-must-be-at-least-32-characters-long",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      ANTHROPIC_API_KEY: "sk-ant-test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadAdapter() {
    const { createAiAdapter } = await import("@/lib/ai/adapter");
    return createAiAdapter();
  }

  it("returns an AnthropicAdapter", async () => {
    const adapter = await loadAdapter();
    expect(adapter.constructor.name).toBe("AnthropicAdapter");
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(loadAdapter()).rejects.toThrow("ANTHROPIC_API_KEY");
  });
});
