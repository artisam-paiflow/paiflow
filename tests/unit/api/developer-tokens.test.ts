import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";
import {
  CreateDeveloperTokenSchema,
  UpdateDeveloperTokenSchema,
  DeveloperTokenListQuerySchema,
  DeveloperTokenSchema,
  CreatedDeveloperTokenSchema,
  DeveloperTokenListSchema,
  DeveloperTokenDeploymentSchema,
  DeveloperTokenDeploymentListSchema,
  DeveloperTokenPermissionSchema,
  DEVELOPER_API_TOKEN_PATTERN,
} from "@/lib/developer-tokens/schema";
import { activeDeveloperTokenFilter } from "@/lib/developer-tokens/service";
import { GET, POST } from "@/app/api/developer-tokens/route";
import { GET as inspect, PATCH, DELETE } from "@/app/api/developer-tokens/[tokenId]/route";
import { GET as candidates } from "@/app/api/developer-tokens/deployments/route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rate, clientIp: () => "127.0.0.1" }));
const depId = randomUUID();
const dep2Id = randomUUID();
const foreignId = randomUUID();
const req = (method = "GET", body?: unknown, query = "") =>
  new NextRequest(`http://localhost/api/developer-tokens${query}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });
const input = (ids: string[] = [depId]) => ({
  label: "integration",
  permission: "READ_ONLY",
  deploymentIds: ids,
});
let ownerId: string;
let otherId: string;
let flowId: string;
let foreignFlowId: string;

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { username: `dev-token-${randomUUID()}` } })).id;
  otherId = (await db.user.create({ data: { username: `dev-token-${randomUUID()}` } })).id;
  flowId = (
    await db.flow.create({
      data: { ownerId, name: "test", graph: {}, parameters: {}, templateKind: "SPLITTER" },
    })
  ).id;
  foreignFlowId = (
    await db.flow.create({
      data: {
        ownerId: otherId,
        name: "foreign",
        graph: {},
        parameters: {},
        templateKind: "SPLITTER",
      },
    })
  ).id;
  await db.deployment.createMany({
    data: [depId, dep2Id].map((id) => ({
      id,
      ownerId,
      flowId,
      network: "testnet",
      graphSnapshot: {},
      paramsSnapshot: {},
      status: "CONFIRMED" as const,
    })),
  });
  await db.deployment.create({
    data: {
      id: foreignId,
      ownerId: otherId,
      flowId: foreignFlowId,
      network: "testnet",
      graphSnapshot: {},
      paramsSnapshot: {},
      status: "CONFIRMED",
    },
  });
});
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: ownerId, role: "USER" });
  await db.developerTokenGrant.deleteMany({ where: { token: { ownerId } } });
  await db.developerApiToken.deleteMany({ where: { ownerId } });
  await db.auditLog.deleteMany({ where: { userId: ownerId } });
  await db.deployment.update({
    where: { id: dep2Id },
    data: { status: "CONFIRMED", serviceState: "ACTIVE", ownerId },
  });
});
afterAll(async () => {
  if (!ownerId) return;
  await db.developerTokenGrant.deleteMany({ where: { token: { ownerId } } });
  await db.developerApiToken.deleteMany({ where: { ownerId } });
  await db.auditLog.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await db.deployment.deleteMany({ where: { id: { in: [depId, dep2Id, foreignId] } } });
  await db.flow.deleteMany({ where: { id: { in: [flowId, foreignFlowId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
});
async function mint(ids: string[] = [depId]) {
  const response = await POST(req("POST", input(ids)));
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

describe("developer token owner lifecycle (PostgreSQL)", () => {
  it("reveals a random credential once, persists its hash, and returns only safe metadata thereafter", async () => {
    const response = await POST(req("POST", { ...input([depId, dep2Id]), expiresInDays: 30 }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.token).toMatch(DEVELOPER_API_TOKEN_PATTERN);
    expect(CreatedDeveloperTokenSchema.safeParse(data).success).toBe(true);
    const stored = await db.developerApiToken.findUniqueOrThrow({ where: { id: data.id } });
    expect(stored.tokenHash).toBe(hashApiToken(data.token));
    expect(stored.tokenPrefix).toBe(data.token.slice(0, 12));
    expect(stored.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    const inspected = (await (await inspect(req(), ctx(data.id))).json()).data;
    expect(DeveloperTokenSchema.safeParse(inspected).success).toBe(true);
    expect(inspected).not.toHaveProperty("token");
    expect(inspected).not.toHaveProperty("tokenHash");
    const listed = (await (await GET(req())).json()).data;
    expect(DeveloperTokenListSchema.safeParse(listed).success).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(data.token);
    const audits = await db.auditLog.findMany({ where: { userId: ownerId } });
    expect(audits.map((a) => a.action)).toEqual(["DEVELOPER_TOKEN_CREATED"]);
    expect(JSON.stringify(audits)).not.toContain(stored.tokenHash);
    expect(JSON.stringify(audits)).not.toContain(data.token);
  });
  it("rejects foreign selections, drafts, retiring, retired and missing deployments", async () => {
    expect((await POST(req("POST", input([foreignId])))).status).toBe(422);
    expect((await POST(req("POST", input([randomUUID()])))).status).toBe(422);
    for (const data of [
      { status: "DRAFT" as const },
      {
        status: "CONFIRMED" as const,
        serviceState: "RETIRING" as const,
        retirementRequestedAt: new Date(),
      },
      {
        status: "CONFIRMED" as const,
        serviceState: "RETIRED" as const,
        retirementRequestedAt: new Date(),
        retiredAt: new Date(),
        retirementReconciledAt: new Date(),
      },
    ]) {
      const unavailable = await db.deployment.create({
        data: {
          ownerId,
          flowId,
          network: "testnet",
          graphSnapshot: {},
          paramsSnapshot: {},
          ...data,
        },
      });
      try {
        expect((await POST(req("POST", input([unavailable.id])))).status).toBe(422);
      } finally {
        await db.deployment.delete({ where: { id: unavailable.id } });
      }
    }
    expect(await db.developerApiToken.count({ where: { ownerId } })).toBe(0);
  });
  it("hides foreign tokens from inspection, replacement and revocation", async () => {
    const token = await mint();
    mocks.session.mockResolvedValue({ id: otherId, role: "USER" });
    for (const response of [
      await inspect(req(), ctx(token.id)),
      await PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id)),
      await DELETE(req("DELETE"), ctx(token.id)),
    ])
      expect(response.status).toBe(404);
    expect((await (await GET(req())).json()).data.items).toEqual([]);
  });
  it("requires an owner session even with a bearer credential and refuses sandbox issuance", async () => {
    mocks.session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Sign in"));
    const bearer = req("POST", input());
    bearer.headers.set("authorization", `Bearer pfd_${"a".repeat(64)}`);
    expect((await POST(bearer)).status).toBe(401);
    mocks.session.mockResolvedValue({ id: ownerId, role: "SANDBOX" });
    expect((await POST(req("POST", input()))).status).toBe(403);
    expect((await GET(req())).status).toBe(403);
  });
  it("atomically replaces grants, refuses invalid replacement, and permits removing all grants", async () => {
    const token = await mint();
    expect((await PATCH(req("PATCH", { deploymentIds: [dep2Id] }), ctx(token.id))).status).toBe(
      200,
    );
    expect((await PATCH(req("PATCH", { deploymentIds: [foreignId] }), ctx(token.id))).status).toBe(
      422,
    );
    expect((await (await inspect(req(), ctx(token.id))).json()).data.deploymentIds).toEqual([
      dep2Id,
    ]);
    expect((await PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id))).status).toBe(200);
    expect(await db.developerTokenGrant.count({ where: { tokenId: token.id } })).toBe(0);
    expect(
      (await db.developerApiToken.findUniqueOrThrow({ where: { id: token.id } })).permission,
    ).toBe("READ_ONLY");
  });
  it("keeps concurrent selection replacements whole and rejects permission edits", async () => {
    const token = await mint();
    const responses = await Promise.all([
      PATCH(req("PATCH", { deploymentIds: [depId] }), ctx(token.id)),
      PATCH(req("PATCH", { deploymentIds: [dep2Id] }), ctx(token.id)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const grants = await db.developerTokenGrant.findMany({ where: { tokenId: token.id } });
    expect(grants).toHaveLength(1);
    expect([depId, dep2Id]).toContain(grants[0]!.deploymentId);
    expect(
      (
        await PATCH(
          req("PATCH", { deploymentIds: [depId], permission: "READ_OPERATE" }),
          ctx(token.id),
        )
      ).status,
    ).toBe(422);
  });
  it("rechecks current ownership on every selection replacement", async () => {
    const token = await mint([dep2Id]);
    await db.deployment.update({ where: { id: dep2Id }, data: { ownerId: otherId } });
    expect((await PATCH(req("PATCH", { deploymentIds: [dep2Id] }), ctx(token.id))).status).toBe(
      422,
    );
    expect((await PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id))).status).toBe(200);
  });
  it("serializes concurrent issuance at the active-token cap and excludes expired/revoked tokens", async () => {
    await db.developerApiToken.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({
        ownerId,
        tokenHash: randomUUID(),
        tokenPrefix: "pfd_safe",
        permission: "READ_ONLY" as const,
        label: String(i),
      })),
    });
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => POST(req("POST", input()))));
    expect(outcomes.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(
      await db.developerApiToken.count({
        where: { ownerId, ...activeDeveloperTokenFilter(new Date()) },
      }),
    ).toBe(10);
    const row = await db.developerApiToken.findFirstOrThrow({ where: { ownerId } });
    await db.developerApiToken.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await mint();
    const another = await db.developerApiToken.findFirstOrThrow({
      where: { ownerId, expiresAt: null },
    });
    await DELETE(req("DELETE"), ctx(another.id));
    await mint();
  });
  it("serializes concurrent replacement and revoke; revocation is idempotent and retains grants", async () => {
    const token = await mint();
    const results = await Promise.all([
      PATCH(req("PATCH", { deploymentIds: [dep2Id] }), ctx(token.id)),
      DELETE(req("DELETE"), ctx(token.id)),
      DELETE(req("DELETE"), ctx(token.id)),
    ]);
    expect([200, 409]).toContain(results[0]!.status);
    expect(results.slice(1).map((r) => r.status)).toEqual([200, 200]);
    expect(await db.developerTokenGrant.count({ where: { tokenId: token.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { userId: ownerId, action: "DEVELOPER_TOKEN_REVOKED" } }),
    ).toBe(1);
    expect((await PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id))).status).toBe(409);
  });
  it("blocks edits to expired tokens but allows revocation", async () => {
    const token = await mint();
    await db.developerApiToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id))).status).toBe(409);
    expect((await DELETE(req("DELETE"), ctx(token.id))).status).toBe(200);
  });
  it("paginates tokens and eligible owner-only deployment choices", async () => {
    await mint();
    await mint();
    const page = (await (await GET(req("GET", undefined, "?limit=1"))).json()).data;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(page.items[0].id);
    const next = (
      await (await GET(req("GET", undefined, `?limit=1&cursor=${page.nextCursor}`))).json()
    ).data;
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(next.nextCursor).toBeNull();
    const eligible = (await (await candidates(req())).json()).data;
    expect(DeveloperTokenDeploymentListSchema.safeParse(eligible).success).toBe(true);
    expect(eligible.items.map((i: { id: string }) => i.id).sort()).toEqual([depId, dep2Id].sort());
    expect((await GET(req("GET", undefined, "?limit=1&limit=2"))).status).toBe(422);
    expect((await inspect(req(), ctx("bad-id"))).status).toBe(404);
  });
  it("rate-limits each write before mutating", async () => {
    const token = await mint();
    for (const action of [
      () => POST(req("POST", input())),
      () => PATCH(req("PATCH", { deploymentIds: [] }), ctx(token.id)),
      () => DELETE(req("DELETE"), ctx(token.id)),
    ]) {
      mocks.rate.mockRejectedValueOnce(new AppError("RATE_LIMITED", "Retry"));
      expect((await action()).status).toBe(429);
      expect(mocks.rate).toHaveBeenLastCalledWith({
        key: `developer-tokens:${ownerId}`,
        limit: 30,
        windowSeconds: 60,
      });
    }
    expect(await db.developerApiToken.count({ where: { ownerId } })).toBe(1);
    const stored = await db.developerApiToken.findUniqueOrThrow({
      where: { id: token.id },
      include: { grants: true },
    });
    expect(stored.revokedAt).toBeNull();
    expect(stored.grants.map((grant) => grant.deploymentId)).toEqual([depId]);
  });
});

describe("developer token shared schemas", () => {
  it("accepts valid inputs and all expiry bounds", () => {
    for (const expiresInDays of [undefined, 1, 30, 90, 365])
      expect(CreateDeveloperTokenSchema.safeParse({ ...input(), expiresInDays }).success).toBe(
        true,
      );
    expect(UpdateDeveloperTokenSchema.parse({ deploymentIds: [] })).toEqual({ deploymentIds: [] });
    expect(DeveloperTokenListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(DeveloperTokenPermissionSchema.parse("READ_OPERATE")).toBe("READ_OPERATE");
  });
  it("rejects unknown fields, immutable edits, duplicate grants, empty/oversized creation and invalid expiries", () => {
    for (const bad of [
      { ...input(), secret: "no" },
      { ...input(), deploymentIds: [] },
      { ...input(), deploymentIds: [depId, depId] },
      { ...input(), deploymentIds: [depId, depId.toUpperCase()] },
      { ...input(), deploymentIds: ["bad"] },
      { ...input(), deploymentIds: Array.from({ length: 101 }, () => randomUUID()) },
      { ...input(), label: " " },
      { ...input(), label: "a".repeat(65) },
      { ...input(), permission: "ADMIN" },
      ...[null, 0, 366, 1.5, "30"].map((expiresInDays) => ({ ...input(), expiresInDays })),
    ])
      expect(CreateDeveloperTokenSchema.safeParse(bad).success).toBe(false);
    for (const extra of [{ permission: "READ_OPERATE" }, { expiresInDays: 30 }, { label: "new" }])
      expect(
        UpdateDeveloperTokenSchema.safeParse({ deploymentIds: [depId], ...extra }).success,
      ).toBe(false);
    for (const query of [{ limit: 0 }, { limit: 101 }, { cursor: "bad" }, { token: "secret" }])
      expect(DeveloperTokenListQuerySchema.safeParse(query).success).toBe(false);
    expect(DeveloperTokenSchema.safeParse({ tokenHash: "secret" }).success).toBe(false);
    expect(
      DeveloperTokenDeploymentSchema.safeParse({
        id: depId,
        flowName: "test",
        network: "testnet",
        token: "secret",
      }).success,
    ).toBe(false);
  });
});
