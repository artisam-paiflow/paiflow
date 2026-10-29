import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { POST } from "@/app/api/files/route";
import { DELETE, GET } from "@/app/api/files/[id]/route";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  limit: vi.fn(),
  fileAsset: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/db", () => ({ db: { fileAsset: mocks.fileAsset } }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.limit }));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const RETIRED = {
  error: {
    code: "FILE_STORAGE_RETIRED",
    message: "Stored-file uploads, downloads and deletion have been retired.",
  },
};
const ENDPOINTS = [
  { method: "POST", path: "/api/files", handler: POST },
  { method: "GET", path: `/api/files/${FILE_ID}`, handler: GET },
  { method: "DELETE", path: `/api/files/${FILE_ID}`, handler: DELETE },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ id: OWNER_ID });
});

describe.each(ENDPOINTS)("retired stored-file endpoint $method", ({ method, path, handler }) => {
  it("returns explicit private 410 without reading or changing file metadata", async () => {
    const req = new NextRequest(`http://localhost${path}`, { method });
    const parse = vi.spyOn(req, "formData").mockRejectedValue(new Error("Body must not be parsed"));
    const response = await handler(req);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(RETIRED);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.fileAsset.findFirst).not.toHaveBeenCalled();
    expect(mocks.fileAsset.create).not.toHaveBeenCalled();
    expect(mocks.fileAsset.delete).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith({
      key: `file:retired:${OWNER_ID}`,
      limit: 60,
      windowSeconds: 60,
    });
  });

  it("requires authentication before retirement details or rate-limit access", async () => {
    mocks.requireSession.mockRejectedValue(new AppError("UNAUTHENTICATED", "Sign in"));
    const response = await handler(new NextRequest(`http://localhost${path}`, { method }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.fileAsset.findFirst).not.toHaveBeenCalled();
    expect(mocks.fileAsset.create).not.toHaveBeenCalled();
    expect(mocks.fileAsset.delete).not.toHaveBeenCalled();
  });

  it("retains a shared owner throttle for retired endpoint requests", async () => {
    mocks.limit.mockRejectedValue(new AppError("RATE_LIMITED", "Wait"));
    const response = await handler(new NextRequest(`http://localhost${path}`, { method }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(mocks.fileAsset.findFirst).not.toHaveBeenCalled();
    expect(mocks.fileAsset.create).not.toHaveBeenCalled();
    expect(mocks.fileAsset.delete).not.toHaveBeenCalled();
  });
});

describe("retired upload bodies", () => {
  it.each([
    { contentType: "multipart/form-data; boundary=missing", body: "malformed multipart" },
    { contentType: "application/json", body: '{"file":"ignored"}' },
  ])("ignores $contentType without consuming the request body", async (input) => {
    const req = new NextRequest("http://localhost/api/files", {
      method: "POST",
      headers: { "Content-Type": input.contentType },
      body: input.body,
    });
    const parse = vi.spyOn(req, "formData").mockRejectedValue(new Error("Body must not be parsed"));
    const response = await POST(req);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(RETIRED);
    expect(req.bodyUsed).toBe(false);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.fileAsset.create).not.toHaveBeenCalled();
  });
});

describe("retired downloads and deletion", () => {
  it.each([GET, DELETE])(
    "returns the same retirement response regardless of file ID",
    async (handler) => {
      for (const id of [FILE_ID, "missing", "not-a-uuid"]) {
        const response = await handler(new NextRequest(`http://localhost/api/files/${id}`));
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual(RETIRED);
      }
      expect(mocks.fileAsset.findFirst).not.toHaveBeenCalled();
      expect(mocks.fileAsset.delete).not.toHaveBeenCalled();
    },
  );
});
