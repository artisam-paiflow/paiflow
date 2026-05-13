import { describe, it, expect } from "vitest";
import { GeminiAdapter } from "@/lib/ai/gemini";
import { AiError } from "@/lib/ai/types";

describe("GeminiAdapter", () => {
  const adapter = new GeminiAdapter({
    apiKey: "test-key",
    model: "gemini-2.0-flash",
  });

  it("returns the assistant text on success", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: '{"nodes":[],"edges":[]}' }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const text = await adapter.chat([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(text).toBe('{"nodes":[],"edges":[]}');
  });

  it("maps assistant role to model role", async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = async (_url, init) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await adapter.chat([
      { role: "system", content: "sys" },
      { role: "assistant", content: "prev" },
      { role: "user", content: "hi" },
    ]);

    expect(capturedBody).not.toBeNull();
    const body = JSON.parse(capturedBody!);
    expect(body.contents[0].role).toBe("user"); // system maps to user in Gemini
    expect(body.contents[1].role).toBe("model"); // assistant -> model
    expect(body.contents[2].role).toBe("user");
  });

  it("throws AiError on HTTP error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Invalid API key", code: 400 } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(AiError);
  });

  it("throws AiError on empty candidates", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Gemini returned no candidates",
    );
  });

  it("throws AiError on non-STOP finish reason", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "truncated" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    await expect(adapter.chat([{ role: "user", content: "hi" }])).rejects.toThrow("MAX_TOKENS");
  });
});
