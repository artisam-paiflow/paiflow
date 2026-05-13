import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaAdapter } from "@/lib/ai/ollama";
import { AiError } from "@/lib/ai/types";

describe("OllamaAdapter", () => {
  const adapter = new OllamaAdapter({
    baseUrl: "http://localhost:11434",
    model: "qwen2.5:3b",
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
        message: { content: '  { "nodes": [], "edges": [] }  ' },
      }),
    } as Response);

    const result = await adapter.chat([{ role: "user", content: "split 50/50" }]);

    expect(result).toBe('{ "nodes": [], "edges": [] }');
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("qwen2.5:3b"),
      }),
    );
  });

  it("throws AiError with friendly message when Ollama is unreachable", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(AiError);

    // Reset mock for the second assertion about the message text
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "Start Ollama or drag blocks manually",
    );
  });

  it("throws AiError on non-2xx HTTP status", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "model not found",
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "Ollama returned",
    );
  });

  it("throws AiError on empty content", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "   " } }),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "empty response",
    );
  });

  it("throws AiError when response JSON contains an error field", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "pull model first" }),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "pull model first",
    );
  });
});
