/**
 * Issue → authenticate → expire → evict, against the real Postgres the suite
 * already uses (see `tests/unit/setup.ts`). The mocked route test proves the
 * handler's logic; this proves the route and `requireDeploymentToken` agree on
 * the stored hash and the deployment binding, and that the FIFO cap actually
 * holds under concurrent callers rather than only in a mocked transaction.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockRateLimit } = vi.hoisted(() => ({
  mockRateLimit: vi.fn(async () => ({ ok: true, remaining: 1, resetAt: 0, shared: true })),
}));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
// The limiter is the subject of the mocked test; here it is held open so the
// cap and the lock are what the concurrency case actually exercises.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mockRateLimit,
  clientIp: () => "203.0.113.9",
}));

import { db } from "@/lib/db";
import { requireDeploymentToken } from "@/lib/api/v1/auth";
import { AppError } from "@/lib/errors";
import { DEMO_MAX_ACTIVE_TOKENS, DEMO_TOKEN_LABEL, demoTokenFilter } from "@/lib/api/v1/tokens";

const suffix = crypto.randomBytes(4).toString("hex");
let userId: string;
let flowId: string;
let demoDeployment: string;
let otherDeployment: string;

/** A CONFIRMED swapper pipeline: what `resolveSwapperPipeline` requires. */
const SWAPPER_SNAPSHOT = [
  { nodeId: "trigger-1", templateKind: "DEPOSIT_TRIGGER", contractAddress: `C${"A".repeat(55)}` },
  { nodeId: "action-1", templateKind: "SWAPPER", contractAddress: `C${"B".repeat(55)}` },
];

function bearer(token: string): NextRequest {
  return { headers: new Headers({ authorization: `Bearer ${token}` }) } as unknown as NextRequest;
}

async function postDemoToken() {
  vi.resetModules();
  const { POST } = await import("@/app/api/v1/demo-token/route");
  const res = await POST(
    new Request("http://localhost/api/v1/demo-token", { method: "POST" }) as never,
  );
  return res;
}

async function issued() {
  const res = await postDemoToken();
  expect(res.status).toBe(201);
  return (await res.json()).data as { deploymentId: string; token: string; expiresAt: string };
}

beforeAll(async () => {
  const user = await db.user.create({
    data: { username: `demo-token-${suffix}`, passwordHash: "hash" },
  });
  userId = user.id;
  const flow = await db.flow.create({
    data: {
      ownerId: userId,
      name: "demo token lifecycle",
      templateKind: "SWAPPER",
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
        pipelineSnapshot: SWAPPER_SNAPSHOT,
      },
    });
  demoDeployment = (await make()).id;
  otherDeployment = (await make()).id;
});

afterAll(async () => {
  for (const deploymentId of [demoDeployment, otherDeployment]) {
    await db.auditLog.deleteMany({
      where: { metadata: { path: ["deploymentId"], equals: deploymentId } },
    });
  }
  // Tokens go with their deployments (onDelete: Cascade).
  await db.deployment.deleteMany({ where: { id: { in: [demoDeployment, otherDeployment] } } });
  await db.flow.deleteMany({ where: { id: flowId } });
  await db.user.deleteMany({ where: { id: userId } });
});

beforeEach(async () => {
  mockRateLimit.mockResolvedValue({ ok: true, remaining: 1, resetAt: 0, shared: true });
  process.env.DEMO_API_ENABLED = "true";
  process.env.DEMO_API_DEPLOYMENT_ID = demoDeployment;
  await db.deploymentApiToken.deleteMany({ where: { deploymentId: demoDeployment } });
});

describe("public demo token lifecycle", () => {
  it("issues a token that authenticates its own deployment and no other", async () => {
    const { token, deploymentId } = await issued();
    expect(deploymentId).toBe(demoDeployment);

    const auth = await requireDeploymentToken(bearer(token), demoDeployment);
    expect(auth.deployment.id).toBe(demoDeployment);
    expect(auth.token.label).toBe(DEMO_TOKEN_LABEL);

    // The binding is the whole authorization model: one token, one deployment.
    await expect(requireDeploymentToken(bearer(token), otherDeployment)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("stops working once it expires, with the one generic refusal", async () => {
    const { token } = await issued();
    await db.deploymentApiToken.updateMany({
      where: { deploymentId: demoDeployment },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(requireDeploymentToken(bearer(token), demoDeployment)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("evicts the oldest holder at the cap and leaves the newcomer working", async () => {
    const first = await issued();
    // Backdate it so "oldest" is unambiguous, then fill the rest of the cap.
    await db.deploymentApiToken.updateMany({
      where: { deploymentId: demoDeployment },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    for (let i = 1; i < DEMO_MAX_ACTIVE_TOKENS; i++) await issued();

    const newcomer = await issued();

    await expect(requireDeploymentToken(bearer(first.token), demoDeployment)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
    const auth = await requireDeploymentToken(bearer(newcomer.token), demoDeployment);
    expect(auth.deployment.id).toBe(demoDeployment);
  });

  it("never revokes a token the operator minted by hand on the same deployment", async () => {
    // An owner-minted row carries a createdById and its own label, so it must fall outside the
    // eviction set however many demo callers arrive.
    const operator = await db.deploymentApiToken.create({
      data: {
        deploymentId: demoDeployment,
        createdById: userId,
        tokenHash: crypto.randomBytes(32).toString("hex"),
        tokenPrefix: "pfk_operator",
        label: "operator",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    for (let i = 0; i <= DEMO_MAX_ACTIVE_TOKENS; i++) await issued();

    const row = await db.deploymentApiToken.findUnique({ where: { id: operator.id } });
    expect(row?.revokedAt).toBeNull();
  });

  it("holds the cap under concurrent callers", async () => {
    // The direct analogue of the owner mint route's cap race: without the
    // FOR NO KEY UPDATE lock, concurrent requests all count the same headroom
    // under READ COMMITTED and every one of them inserts.
    const n = DEMO_MAX_ACTIVE_TOKENS + 10;
    const results = await Promise.all(Array.from({ length: n }, () => postDemoToken()));
    expect(results.every((r) => r.status === 201)).toBe(true);

    const live = await db.deploymentApiToken.count({
      where: { deploymentId: demoDeployment, ...demoTokenFilter(new Date()) },
    });
    expect(live).toBeLessThanOrEqual(DEMO_MAX_ACTIVE_TOKENS);
  });
});
