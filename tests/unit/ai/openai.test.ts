import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiAdapter } from "@/lib/ai/openai";
import { AiError } from "@/lib/ai/types";

describe("OpenAiAdapter", () => {
  const adapter = new OpenAiAdapter({
    apiKey: "sk-test",
    model: "gpt-4o-mini",
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns assistant content on success", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '  { "suggestions": [] }  ' } }],
      }),
    } as Response);

    const result = await adapter.chat([{ role: "user", content: "review this flow" }]);

    expect(result).toBe('{ "suggestions": [] }');
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: expect.stringContaining("gpt-4o-mini"),
      }),
    );
  });

  it("throws AiError when OpenAI is unreachable", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error("ENOTFOUND"));

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(AiError);
  });

  it("throws AiError on non-2xx status", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "rate limited",
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "OpenAI returned",
    );
  });

  it("throws AiError on empty content", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "empty response",
    );
  });

  it("throws AiError when response contains an error object", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [],
        error: { message: "invalid api key" },
      }),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "invalid api key",
    );
  });
});
