import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "@/lib/ai/anthropic";
import { AiError } from "@/lib/ai/types";

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter({
    apiKey: "test-key",
    model: "claude-3-5-sonnet-20241022",
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns assistant text on success", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "  hello  " }] }),
      json: async () => ({ content: [{ type: "text", text: "  hello  " }] }),
    } as Response);

    const text = await adapter.chat([
      { role: "system", content: "You are a bot" },
      { role: "user", content: "hi" },
    ]);

    expect(text).toBe("hello");
    expect(mockFetch).toHaveBeenCalledOnce();

    const call = mockFetch.mock.calls[0]!;
    const [, req] = call;
    expect(req).toBeDefined();
    const body = JSON.parse((req as RequestInit).body as string);
    expect(body.model).toBe("claude-3-5-sonnet-20241022");
    expect(body.system).toBe("You are a bot");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect((req as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("joins multiple system messages", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as Response);

    await adapter.chat([
      { role: "system", content: "Sys1" },
      { role: "system", content: "Sys2" },
      { role: "user", content: "hi" },
    ]);

    const call = mockFetch.mock.calls[0]!;
    const [, req] = call;
    expect(req).toBeDefined();
    const body = JSON.parse((req as RequestInit).body as string);
    expect(body.system).toBe("Sys1\n\nSys2");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("throws AiError on fetch failure", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(AiError);
  });

  it("throws AiError on non-OK response", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    const errBody = JSON.stringify({ error: { type: "authentication_error", message: "bad key" } });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => errBody,
      json: async () => JSON.parse(errBody),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Anthropic error: bad key",
    );
  });

  it("throws AiError on empty response", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: "thinking" }] }),
      json: async () => ({ content: [{ type: "thinking" }] }),
    } as Response);

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Anthropic returned an empty response",
    );
  });

  it("throws AiError on invalid JSON", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "not json",
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Anthropic returned invalid JSON",
    );
  });
});
