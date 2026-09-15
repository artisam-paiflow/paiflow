/**
 * Mint → authenticate → revoke → refused, against the real Postgres the suite
 * already uses (see `tests/unit/setup.ts`). The mocked route tests prove each
 * handler's logic; this proves the pieces agree on the stored hash, the
 * deployment binding and what "revoked" means in the actual table.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockRequireSession } = vi.hoisted(() => ({ mockRequireSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));

import { db } from "@/lib/db";
import { requireDeploymentToken } from "@/lib/api/v1/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { GET, POST } from "@/app/api/deployments/[id]/api-tokens/route";
import { DELETE } from "@/app/api/deployments/[id]/api-tokens/[tokenId]/route";

const suffix = crypto.randomBytes(4).toString("hex");
let userId: string;
let flowId: string;
let deploymentA: string;
let deploymentB: string;
let deploymentC: string;

function bearer(token: string): NextRequest {
  return { headers: new Headers({ authorization: `Bearer ${token}` }) } as unknown as NextRequest;
}

function routeReq(method: string, body?: unknown): NextRequest {
  return new Request("http://localhost/api/deployments/x/api-tokens", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeAll(async () => {
  const user = await db.user.create({
    data: { username: `token-lifecycle-${suffix}`, passwordHash: "hash" },
  });
  userId = user.id;
  const flow = await db.flow.create({
    data: {
      ownerId: userId,
      name: "token lifecycle",
      templateKind: "SPLITTER",
      graph: {},
      parameters: {},
    },
  });
  flowId = flow.id;
  const make = () =>
    db.deployment.create({
      data: {
        flowId,
        ownerId: userId,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  deploymentA = (await make()).id;
  deploymentB = (await make()).id;
  deploymentC = (await make()).id;
});

afterAll(async () => {
  for (const deploymentId of [deploymentA, deploymentB, deploymentC]) {
    await db.auditLog.deleteMany({
      where: { metadata: { path: ["deploymentId"], equals: deploymentId } },
    });
  }
  // Tokens go with their deployments (onDelete: Cascade).
  await db.deployment.deleteMany({
    where: { id: { in: [deploymentA, deploymentB, deploymentC] } },
  });
  await db.flow.deleteMany({ where: { id: flowId } });
  await db.user.deleteMany({ where: { id: userId } });
});

beforeEach(() => {
  mockRequireSession.mockResolvedValue({ id: userId, username: "owner", role: "USER" });
});

describe("deployment API token lifecycle", () => {
  it("mints a token that authenticates its own deployment until it is revoked", async () => {
    const created = await POST(routeReq("POST", { label: "lifecycle" }), {
      params: Promise.resolve({ id: deploymentA }),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json();

    const row = await db.deploymentApiToken.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.tokenHash).toBe(hashApiToken(data.token));
    expect(row.tokenHash).not.toBe(data.token);

    const auth = await requireDeploymentToken(bearer(data.token), deploymentA);
    expect(auth.token.id).toBe(data.id);
    expect(auth.deployment.id).toBe(deploymentA);

    await expect(requireDeploymentToken(bearer(data.token), deploymentB)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    const revoked = await DELETE(routeReq("DELETE"), {
      params: Promise.resolve({ id: deploymentA, tokenId: data.id }),
    });
    expect(revoked.status).toBe(200);

    await expect(requireDeploymentToken(bearer(data.token), deploymentA)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    const audits = await db.auditLog.findMany({
      where: { metadata: { path: ["tokenId"], equals: data.id } },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["API_TOKEN_CREATED", "API_TOKEN_REVOKED"]);
  });

  it("does not let another user revoke the token", async () => {
    const created = await POST(routeReq("POST", {}), {
      params: Promise.resolve({ id: deploymentA }),
    });
    const { data } = await created.json();

    mockRequireSession.mockResolvedValue({
      id: crypto.randomUUID(),
      username: "someone-else",
      role: "USER",
    });
    const res = await DELETE(routeReq("DELETE"), {
      params: Promise.resolve({ id: deploymentA, tokenId: data.id }),
    });
    expect(res.status).toBe(404);

    const row = await db.deploymentApiToken.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.revokedAt).toBeNull();
  });

  it("holds the active-token cap when mints race", async () => {
    await db.deploymentApiToken.createMany({
      data: Array.from({ length: 9 }, () => ({
        deploymentId: deploymentC,
        createdById: userId,
        tokenHash: crypto.randomBytes(32).toString("hex"),
        tokenPrefix: "pfk_seed0000",
      })),
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(routeReq("POST", {}), { params: Promise.resolve({ id: deploymentC }) }),
      ),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const active = await db.deploymentApiToken.count({
      where: { deploymentId: deploymentC, revokedAt: null },
    });
    expect(active).toBe(10);
  });

  it("keeps active tokens on the list behind a page of newer revoked ones", async () => {
    const later = new Date(Date.now() + 60_000);
    await db.deploymentApiToken.createMany({
      data: Array.from({ length: 100 }, () => ({
        deploymentId: deploymentC,
        createdById: userId,
        tokenHash: crypto.randomBytes(32).toString("hex"),
        tokenPrefix: "pfk_revoked0",
        createdAt: later,
        revokedAt: later,
      })),
    });

    const res = await GET(routeReq("GET"), { params: Promise.resolve({ id: deploymentC }) });
    const { data } = await res.json();
    expect(data).toHaveLength(100);
    const firstTen = data.slice(0, 10) as { revokedAt: string | null }[];
    expect(firstTen.every((t) => t.revokedAt === null)).toBe(true);
    expect(data.filter((t: { revokedAt: string | null }) => t.revokedAt === null)).toHaveLength(10);
  });
});
