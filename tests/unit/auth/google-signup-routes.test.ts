import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const h = vi.hoisted(() => ({
  require: vi.fn(),
  limit: vi.fn(),
  writeLimit: vi.fn(),
  audit: vi.fn(),
  intent: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireSession: h.require }));
vi.mock("@/lib/db", () => ({ db: { googleSignupCode: { findMany: h.list, update: h.disable } } }));
vi.mock("@/lib/auth/google-signup", async (original) => {
  const module = await original<typeof import("@/lib/auth/google-signup")>();
  return { ...module, createGoogleSignupIntent: h.intent, createGoogleSignupCode: h.create };
});
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "192.0.2.1", enforceRateLimit: h.limit }));
vi.mock("@/lib/api/write-rate-limit", () => ({ enforceWriteRateLimit: h.writeLimit }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return { ...module, env: () => ({ ...module.env(), AUTH_URL: "https://app.example" }) };
});
import { POST as validate } from "@/app/api/auth/google/signup/route";
import { GET as list, POST as create } from "@/app/api/admin/google-signup-codes/route";
import { PATCH as disable } from "@/app/api/admin/google-signup-codes/[id]/route";
import { AppError } from "@/lib/errors";
import { GOOGLE_SIGNUP_COOKIE } from "@/lib/auth/google-signup";
function request(path: string, origin = "https://app.example", cookie?: string) {
  return new NextRequest(`https://app.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ code: "private-code", label: "Event", days: 7 }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.require.mockResolvedValue({ id: "admin-id", role: "ADMIN" });
  h.intent.mockResolvedValue("browser-grant");
  h.list.mockResolvedValue([]);
  h.create.mockResolvedValue({ id: "code-id", code: "raw-once" });
  h.disable.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
});
describe("Google invitation API security", () => {
  it("validates only from the canonical origin", async () => {
    const response = await validate(request("/api/auth/google/signup", "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(h.intent).not.toHaveBeenCalled();
  });
  it("sets protected browser state only after validation, with no token in JSON", async () => {
    const response = await validate(request("/api/auth/google/signup"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ok: true } });
    expect(response.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value).toBe("browser-grant");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(h.limit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "google-signup-code-ip:192.0.2.1", limit: 600 }),
    );
    expect(h.limit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("google-signup-code-browser:"),
        limit: 10,
      }),
    );
  });
  it("persists the same browser attempt budget across invalid requests", async () => {
    h.intent.mockRejectedValue(new AppError("VALIDATION", "This code is disabled."));
    const first = await validate(request("/api/auth/google/signup"));
    expect(first.status).toBe(422);
    expect(first.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value).toBe("");
    const budget = first.cookies.get("paiflow.google-code-attempt")!.value;
    const second = await validate(
      request(
        "/api/auth/google/signup",
        "https://app.example",
        `paiflow.google-code-attempt=${budget}`,
      ),
    );
    expect(second.cookies.get("paiflow.google-code-attempt")!.value).toBe(budget);
    expect(h.limit.mock.calls[1]![0].key).toBe(h.limit.mock.calls[3]![0].key);
  });
  it("does not validate or mint a grant when rate limited", async () => {
    h.limit.mockRejectedValue(
      new AppError("RATE_LIMITED", "Too many requests", undefined, undefined, 60),
    );
    const response = await validate(request("/api/auth/google/signup"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(h.intent).not.toHaveBeenCalled();
  });
  it.each(["list", "create", "disable"])(
    "refuses non-admin %s access before reading or writing codes",
    async (operation) => {
      h.require.mockRejectedValue(new AppError("FORBIDDEN", "Insufficient permissions"));
      const response =
        operation === "list"
          ? await list()
          : operation === "create"
            ? await create(request("/api/admin/google-signup-codes"))
            : await disable(request("/api/admin/google-signup-codes/id"), {
                params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
              });
      expect(response.status).toBe(403);
      expect(h.require).toHaveBeenCalledWith({ role: "ADMIN" });
      expect(h.list).not.toHaveBeenCalled();
      expect(h.create).not.toHaveBeenCalled();
      expect(h.disable).not.toHaveBeenCalled();
    },
  );
  it("returns an uncached once-only code to admins and audits only its ID", async () => {
    const response = await create(request("/api/admin/google-signup-codes"));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(h.audit).toHaveBeenCalledWith({
      action: "ADMIN_GOOGLE_SIGNUP_CODE_CREATE",
      userId: "admin-id",
      metadata: { codeId: "code-id" },
    });
  });
  it("admin listing uses a selection that excludes hashes and raw codes", async () => {
    const response = await list();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(h.list.mock.calls[0]![0].select).not.toHaveProperty("codeHash");
    expect(h.list.mock.calls[0]![0].select).not.toHaveProperty("code");
  });
  it("disable uses the admin guard and records a disable time and audit ID", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const response = await disable(request("/api/admin/google-signup-codes/id"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);
    expect(h.disable).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id }, data: { disabledAt: expect.any(Date) } }),
    );
    expect(h.audit).toHaveBeenCalledWith({
      action: "ADMIN_GOOGLE_SIGNUP_CODE_DISABLE",
      userId: "admin-id",
      metadata: { codeId: id },
    });
  });
});
