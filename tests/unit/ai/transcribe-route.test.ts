import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  feature: vi.fn(),
  rateLimit: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/features", () => ({ requireFeature: mocks.feature }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/groq", () => ({ transcribeAudio: mocks.transcribe }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Transcription must not use database persistence");
      },
    },
  ),
}));

import { POST } from "@/app/api/transcribe/route";

const audioBytes = new Uint8Array([0, 255, 17, 128, 42]);

function request(file?: File | string): NextRequest {
  const body = new FormData();
  if (file !== undefined) body.set("file", file);
  return new NextRequest("https://app.example/api/transcribe", { method: "POST", body });
}

describe("POST /api/transcribe during stored-file retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReset().mockResolvedValue({ id: "audio-owner" });
    mocks.feature.mockReset();
    mocks.rateLimit.mockReset().mockResolvedValue(undefined);
    mocks.transcribe.mockReset().mockResolvedValue("Send half to Alice");
  });

  it.each([
    ["audio/webm;codecs=opus", "audio/webm"],
    ["audio/mp4", "audio/mp4"],
    ["audio/wav", "audio/wav"],
  ])("forwards %s audio bytes without persisting a stored file", async (type, baseType) => {
    const response = await POST(request(new File([audioBytes], "recording.audio", { type })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { text: "Send half to Alice" } });
    expect(mocks.transcribe).toHaveBeenCalledExactlyOnceWith(
      Buffer.from(audioBytes),
      "recording.audio",
      baseType,
    );
    expect(mocks.feature).toHaveBeenCalledExactlyOnceWith("aiAssistant");
    expect(mocks.rateLimit).toHaveBeenCalledExactlyOnceWith({
      key: "transcribe:audio-owner",
      limit: 20,
      windowSeconds: 600,
      message: "Too many transcription requests",
    });
  });

  it("requires authentication before parsing audio or calling the provider", async () => {
    mocks.session.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "Authentication required"));
    const req = request(new File([audioBytes], "recording.webm", { type: "audio/webm" }));
    const parse = vi.spyOn(req, "formData");

    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.feature).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("honours the disabled AI feature before parsing audio", async () => {
    mocks.feature.mockImplementationOnce(() => {
      throw new AppError("NOT_FOUND", "AI assistant is disabled");
    });
    const req = request(new File([audioBytes], "recording.webm", { type: "audio/webm" }));
    const parse = vi.spyOn(req, "formData");

    const response = await POST(req);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("preserves the transcription rate limit before parsing audio", async () => {
    mocks.rateLimit.mockRejectedValueOnce(
      new AppError("RATE_LIMITED", "Too many transcription requests"),
    );
    const req = request(new File([audioBytes], "recording.webm", { type: "audio/webm" }));
    const parse = vi.spyOn(req, "formData");

    const response = await POST(req);

    expect(response.status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it.each([undefined, "not an audio file"])(
    "rejects a missing/non-file audio field (%s)",
    async (file) => {
      const response = await POST(request(file));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION", message: "Missing audio file" },
      });
      expect(mocks.transcribe).not.toHaveBeenCalled();
    },
  );

  it("rejects stored-file content types instead of forwarding them as audio", async () => {
    const response = await POST(
      request(new File(["private document"], "document.pdf", { type: "application/pdf" })),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION" } });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("rejects audio over 25 MiB before reading its bytes", async () => {
    const file = new File([audioBytes], "too-large.webm", { type: "audio/webm" });
    Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
    const read = vi.spyOn(file, "arrayBuffer");
    const form = new FormData();
    form.set("file", file);
    const req = request();
    vi.spyOn(req, "formData").mockResolvedValueOnce(form);

    const response = await POST(req);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION", message: "Audio file too large (max 25 MB)" },
    });
    expect(read).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});
