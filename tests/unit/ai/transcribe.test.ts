import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/log", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import { transcribeAudio } from "@/lib/ai/groq";

const AUDIO_BUF = Buffer.from("fake-audio-data");
const FILENAME = "recording.webm";

function mockFetchOnce(status: number, body: unknown, opts?: { ok?: boolean }) {
  return vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: opts?.ok ?? status < 400,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response);
}

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_STT_MODEL_PRIMARY", "whisper-large-v3");
    vi.stubEnv("GROQ_STT_MODEL_FALLBACK", "whisper-large-v3-turbo");
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ text: "hello world" }),
      } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns transcribed text on success", async () => {
    const result = await transcribeAudio(AUDIO_BUF, FILENAME);
    expect(result).toBe("hello world");
  });

  it("falls back to turbo when primary returns 429", async () => {
    vi.mocked(global.fetch).mockReset();
    mockFetchOnce(429, "rate limited");
    mockFetchOnce(200, { text: "fallback result" });

    const result = await transcribeAudio(AUDIO_BUF, FILENAME);
    expect(result).toBe("fallback result");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it("falls back to turbo when primary returns 5xx", async () => {
    vi.mocked(global.fetch).mockReset();
    mockFetchOnce(502, "upstream error");
    mockFetchOnce(200, { text: "fallback result" });

    const result = await transcribeAudio(AUDIO_BUF, FILENAME);
    expect(result).toBe("fallback result");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it("throws RATE_LIMITED when both models return 429", async () => {
    vi.mocked(global.fetch)
      .mockReset()
      .mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
        json: async () => ({}),
      } as Response);

    const err = await transcribeAudio(AUDIO_BUF, FILENAME).catch((e) => e);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toMatch(/rate-limited/i);
  });

  it("throws UPSTREAM_RPC when both models fail with non-429", async () => {
    vi.mocked(global.fetch)
      .mockReset()
      .mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "server error",
        json: async () => ({}),
      } as Response);

    const err = await transcribeAudio(AUDIO_BUF, FILENAME).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_RPC");
    expect(err.message).toMatch(/failed on all models/i);
  });

  it("throws INTERNAL when GROQ_API_KEY is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    const err = await transcribeAudio(AUDIO_BUF, FILENAME).catch((e) => e);
    expect(err.code).toBe("INTERNAL");
    expect(err.message).toMatch(/GROQ_API_KEY/i);
  });

  it("throws UPSTREAM_RPC when Groq returns empty text", async () => {
    vi.mocked(global.fetch)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

    const err = await transcribeAudio(AUDIO_BUF, FILENAME).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_RPC");
    expect(err.message).toMatch(/failed on all models/i);
  });
});
