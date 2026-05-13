import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("createAiAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-auth-secret-must-be-at-least-32-characters-long",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadAdapter() {
    // Dynamic import so env is re-evaluated each time
    const { createAiAdapter } = await import("@/lib/ai/adapter");
    return createAiAdapter();
  }

  it("returns an OllamaAdapter by default", async () => {
    delete process.env.AI_PROVIDER;
    const adapter = await loadAdapter();
    expect(adapter.constructor.name).toBe("OllamaAdapter");
  });

  it("returns an OllamaAdapter when AI_PROVIDER=ollama", async () => {
    process.env.AI_PROVIDER = "ollama";
    const adapter = await loadAdapter();
    expect(adapter.constructor.name).toBe("OllamaAdapter");
  });

  it("returns an OpenAiAdapter when AI_PROVIDER=openai and key is present", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const adapter = await loadAdapter();
    expect(adapter.constructor.name).toBe("OpenAiAdapter");
  });

  it("throws when AI_PROVIDER=openai but OPENAI_API_KEY is missing", async () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    await expect(loadAdapter()).rejects.toThrow("OPENAI_API_KEY is required");
  });
});
