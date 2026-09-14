import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb, mockRequireSession, mockAudit, mockEnforceRateLimit } = vi.hoisted(() => {
  const mockDb = {
    deployment: { findFirst: vi.fn() },
    deploymentApiToken: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return {
    mockDb,
    mockRequireSession: vi.fn(),
    mockAudit: vi.fn(),
    mockEnforceRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  clientIp: () => "203.0.113.7",
}));

import { GET, POST } from "@/app/api/deployments/[id]/api-tokens/route";
import { DELETE } from "@/app/api/deployments/[id]/api-tokens/[tokenId]/route";
import { DEPLOYMENT_API_TOKEN_PATTERN } from "@/lib/api/v1/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";

const USER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", username: "owner", role: "USER" };
const SANDBOX = { ...USER, role: "SANDBOX" };
const DEP_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    tokenPrefix: "pfk_abcdef01",
    label: "partner",
    createdAt: new Date("2026-09-14T00:00:00Z"),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function req(method: string, body?: unknown): NextRequest {
  return new Request(`http://localhost/api/deployments/${DEP_ID}/api-tokens`, {
    method,
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ctx = (id = DEP_ID) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (tokenId = TOKEN_ID, id = DEP_ID) => ({
  params: Promise.resolve({ id, tokenId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(USER);
  mockEnforceRateLimit.mockResolvedValue(undefined);
  mockDb.deployment.findFirst.mockResolvedValue({ id: DEP_ID, status: "CONFIRMED" });
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
  mockDb.deploymentApiToken.count.mockResolvedValue(0);
  mockDb.deploymentApiToken.create.mockImplementation(async () => tokenRow());
});

describe("POST /api/deployments/:id/api-tokens", () => {
  it("returns the plaintext once and stores only its hash", async () => {
    const res = await POST(req("POST", { label: "partner", expiresInDays: 30 }), ctx());
    expect(res.status).toBe(201);
    const { data } = await res.json();

    expect(data.token).toMatch(DEPLOYMENT_API_TOKEN_PATTERN);
    const created = mockDb.deploymentApiToken.create.mock.calls[0]![0];
    expect(created.data).toMatchObject({
      deploymentId: DEP_ID,
      createdById: USER.id,
      tokenHash: hashApiToken(data.token),
      tokenPrefix: data.token.slice(0, 12),
      label: "partner",
    });
    expect(JSON.stringify(created.data)).not.toContain(data.token);
    expect(created.select).not.toHaveProperty("tokenHash");
    const days = (created.data.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("audits the creation without the plaintext or the hash", async () => {
    const res = await POST(req("POST", {}), ctx());
    const { data } = await res.json();

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const entry = mockAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({
      action: "API_TOKEN_CREATED",
      userId: USER.id,
      ip: "203.0.113.7",
      metadata: { deploymentId: DEP_ID, tokenId: TOKEN_ID, tokenPrefix: data.token.slice(0, 12) },
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(data.token);
    expect(serialized).not.toContain(hashApiToken(data.token));
  });

  it("creates a token with no label and no expiry", async () => {
    await POST(req("POST", {}), ctx());
    const created = mockDb.deploymentApiToken.create.mock.calls[0]![0];
    expect(created.data).toMatchObject({ label: null, expiresAt: null });
  });

  it("mints a different token every time", async () => {
    const a = (await (await POST(req("POST", {}), ctx())).json()).data.token;
    const b = (await (await POST(req("POST", {}), ctx())).json()).data.token;
    expect(a).not.toBe(b);
  });

  it("refuses an eleventh active token with 409", async () => {
    mockDb.deploymentApiToken.count.mockResolvedValue(10);
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("locks the deployment row before counting toward the cap", async () => {
    await POST(req("POST", {}), ctx());
    const [lock] = mockDb.$queryRaw.mock.invocationCallOrder;
    const [count] = mockDb.deploymentApiToken.count.mock.invocationCallOrder;
    expect(lock).toBeLessThan(count!);
    const [strings, lockedId] = mockDb.$queryRaw.mock.calls[0]!;
    expect((strings as string[]).join("?")).toMatch(/FOR UPDATE/);
    expect(lockedId).toBe(DEP_ID);
  });

  it("counts only unrevoked, unexpired tokens toward the cap", async () => {
    await POST(req("POST", {}), ctx());
    const { where } = mockDb.deploymentApiToken.count.mock.calls[0]![0];
    expect(where).toMatchObject({ deploymentId: DEP_ID, revokedAt: null });
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("refuses an unconfirmed deployment with 422", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: DEP_ID, status: "PENDING" });
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(422);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });

  it.each([
    ["label too long", { label: "x".repeat(65) }, "label"],
    ["blank label", { label: "   " }, "label"],
    ["expiry zero", { expiresInDays: 0 }, "expiresInDays"],
    ["expiry over a year", { expiresInDays: 366 }, "expiresInDays"],
    ["fractional expiry", { expiresInDays: 1.5 }, "expiresInDays"],
    ["expiry as string", { expiresInDays: "30" }, "expiresInDays"],
  ])("refuses a bad body with 422 and fields (%s)", async (_name, body, field) => {
    const res = await POST(req("POST", body), ctx());
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION");
    expect(error.fields).toHaveProperty(field);
  });

  it("refuses unknown keys, so a caller cannot set its own hash or deployment", async () => {
    const res = await POST(req("POST", { tokenHash: "x", deploymentId: DEP_ID }), ctx());
    expect(res.status).toBe(422);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a deployment the caller does not own", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(404);
    expect(mockDb.deployment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEP_ID, ownerId: USER.id } }),
    );
  });

  it("rate-limits per user", async () => {
    await POST(req("POST", {}), ctx());
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      key: `api-tokens:${USER.id}`,
      limit: 20,
      windowSeconds: 60,
    });
  });

  it("surfaces a rate limit as 429", async () => {
    mockEnforceRateLimit.mockRejectedValue(new AppError("RATE_LIMITED", "Too many requests"));
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(429);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/deployments/:id/api-tokens", () => {
  it("lists tokens without a hash", async () => {
    mockDb.deploymentApiToken.findMany.mockResolvedValue([tokenRow()]);
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty("tokenHash");
    const args = mockDb.deploymentApiToken.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ deploymentId: DEP_ID });
    expect(args.select).not.toHaveProperty("tokenHash");
  });

  it("returns 404 for a deployment the caller does not own", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(404);
    expect(mockDb.deploymentApiToken.findMany).not.toHaveBeenCalled();
  });

  it("lists tokens for an unconfirmed deployment too", async () => {
    mockDb.deployment.findFirst.mockResolvedValue({ id: DEP_ID, status: "FAILED" });
    mockDb.deploymentApiToken.findMany.mockResolvedValue([]);
    expect((await GET(req("GET"), ctx())).status).toBe(200);
  });
});

describe("DELETE /api/deployments/:id/api-tokens/:tokenId", () => {
  beforeEach(() => {
    mockDb.deploymentApiToken.findFirst.mockResolvedValue({ id: TOKEN_ID });
    mockDb.deploymentApiToken.updateMany.mockResolvedValue({ count: 1 });
    mockDb.deploymentApiToken.findUniqueOrThrow.mockResolvedValue(
      tokenRow({ revokedAt: new Date() }),
    );
  });

  it("sets revokedAt, never deletes, and audits once", async () => {
    const res = await DELETE(req("DELETE"), tokenCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.revokedAt).toBeTruthy();

    expect(mockDb.deploymentApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: TOKEN_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0]![0]).toMatchObject({
      action: "API_TOKEN_REVOKED",
      userId: USER.id,
      metadata: { deploymentId: DEP_ID, tokenId: TOKEN_ID, tokenPrefix: "pfk_abcdef01" },
    });
  });

  it("is idempotent: revoking a revoked token returns it without a second audit row", async () => {
    mockDb.deploymentApiToken.updateMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(req("DELETE"), tokenCtx());
    expect(res.status).toBe(200);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns 404 for a token that belongs to another deployment", async () => {
    mockDb.deploymentApiToken.findFirst.mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), tokenCtx());
    expect(res.status).toBe(404);
    expect(mockDb.deploymentApiToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TOKEN_ID, deploymentId: DEP_ID } }),
    );
    expect(mockDb.deploymentApiToken.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for a deployment the caller does not own", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), tokenCtx());
    expect(res.status).toBe(404);
    expect(mockDb.deploymentApiToken.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-UUID token id", async () => {
    const res = await DELETE(req("DELETE"), tokenCtx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(mockDb.deploymentApiToken.findFirst).not.toHaveBeenCalled();
  });
});

describe("guards shared by all three handlers", () => {
  const calls = [
    ["GET", () => GET(req("GET"), ctx())],
    ["POST", () => POST(req("POST", {}), ctx())],
    ["DELETE", () => DELETE(req("DELETE"), tokenCtx())],
  ] as const;

  it.each(calls)(
    "%s refuses a sandbox session with 403 before touching the db",
    async (_m, call) => {
      mockRequireSession.mockResolvedValue(SANDBOX);
      const res = await call();
      expect(res.status).toBe(403);
      expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(calls)("%s refuses a signed-out caller with 401", async (_m, call) => {
    mockRequireSession.mockRejectedValue(
      new AppError("UNAUTHENTICATED", "Authentication required"),
    );
    expect((await call()).status).toBe(401);
  });

  it("returns 404 for a non-UUID deployment id", async () => {
    const res = await GET(req("GET"), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
  });
});
