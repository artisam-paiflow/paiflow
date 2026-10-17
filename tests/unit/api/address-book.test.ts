import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { POST } from "@/app/api/address-book/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rate: vi.fn(),
  entry: { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { addressBookEntry: mocks.entry } }));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: mocks.rate }));
const ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
function request(body: unknown) {
  return new NextRequest("http://localhost/api/address-book", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "owner" });
  mocks.entry.findFirst.mockResolvedValue(null);
  mocks.entry.create.mockResolvedValue({ id: "new", label: "Alice", address: ADDRESS });
  mocks.entry.upsert.mockResolvedValue({ id: "existing", label: "Alice", address: ADDRESS });
});
describe("Inline address-book creation", () => {
  it("creates an owner-scoped contact without ever invoking upsert", async () => {
    const response = await POST(request({ label: "Alice", address: ADDRESS, createOnly: true }));
    expect(response.status).toBe(200);
    expect(mocks.entry.create).toHaveBeenCalledWith({
      data: { ownerId: "owner", label: "Alice", address: ADDRESS },
    });
    expect(mocks.entry.upsert).not.toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledWith("addressBookWrite", "owner");
  });
  it("rejects a stale or racing duplicate name instead of replacing its wallet", async () => {
    mocks.entry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const response = await POST(request({ label: "Alice", address: ADDRESS, createOnly: true }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.fields.label[0]).toContain("Choose a different name");
    expect(mocks.entry.upsert).not.toHaveBeenCalled();
  });
  it("still rejects the same wallet saved under another name", async () => {
    mocks.entry.findFirst.mockResolvedValue({ label: "Original contact", address: ADDRESS });
    const response = await POST(request({ label: "Alice", address: ADDRESS, createOnly: true }));
    expect(response.status).toBe(409);
    expect(mocks.entry.findFirst).toHaveBeenCalledWith({
      where: { ownerId: "owner", address: ADDRESS, NOT: { label: "Alice" } },
    });
    expect(mocks.entry.create).not.toHaveBeenCalled();
    expect(mocks.entry.upsert).not.toHaveBeenCalled();
  });
  it("preserves existing non-inline callers' label upserts", async () => {
    const response = await POST(request({ label: "Alice", address: ADDRESS }));
    expect(response.status).toBe(200);
    expect(mocks.entry.upsert).toHaveBeenCalledWith({
      where: { ownerId_label: { ownerId: "owner", label: "Alice" } },
      update: { address: ADDRESS },
      create: { ownerId: "owner", label: "Alice", address: ADDRESS },
    });
    expect(mocks.entry.create).not.toHaveBeenCalled();
  });
  it("requires a session and does not write on validation or rate-limit failure", async () => {
    mocks.session.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "Sign in"));
    expect(
      (await POST(request({ label: "Alice", address: ADDRESS, createOnly: true }))).status,
    ).toBe(401);
    expect((await POST(request({ label: " ", address: ADDRESS, createOnly: true }))).status).toBe(
      422,
    );
    mocks.rate.mockRejectedValueOnce(new AppError("RATE_LIMITED", "Wait"));
    expect(
      (await POST(request({ label: "Alice", address: ADDRESS, createOnly: true }))).status,
    ).toBe(429);
    expect(mocks.entry.create).not.toHaveBeenCalled();
    expect(mocks.entry.upsert).not.toHaveBeenCalled();
  });
});
