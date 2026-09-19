/**
 * The public demo token endpoint: how an unauthenticated reviewer gets a working
 * `pfk_` credential for the partner API (SOW §3.8).
 *
 * What must hold: the route is off unless DEMO_API_ENABLED, it is capped per IP
 * and instance-wide with the instance-wide cap failing closed, every way the
 * demo deployment can be unusable produces one indistinguishable refusal, and
 * the token it issues is bound to the env-pinned deployment for sixty minutes
 * no matter what the caller puts in the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiToken } from "@/lib/auth/api-token";
import { DEMO_MAX_ACTIVE_TOKENS, DEMO_TOKEN_LABEL } from "@/lib/api/v1/tokens";

const DEMO_ID = "0786fca6-ed7c-405b-a819-6aaae424c215";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "99999999-8888-4777-8666-555555555555";

const { mockDb, mockRateLimit, mockAudit, mockLog } = vi.hoisted(() => {
  const tokenTx = {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  };
  return {
    mockDb: {
      deployment: { findUnique: vi.fn() },
      deploymentApiToken: tokenTx,
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    },
    mockRateLimit: vi.fn(),
    mockAudit: vi.fn(),
    mockLog: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  };
});

// The route reaches lib/api/v1/tokens for its constants, which imports requireSession and so
// drags NextAuth into the runtime. The route itself never calls it — this is an anonymous
// endpoint. Same stub the sibling token tests use.
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));
vi.mock("@/lib/log", () => ({ log: mockLog }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mockRateLimit,
  clientIp: vi.fn(() => "203.0.113.9"),
}));

/** A CONFIRMED swapper pipeline, the shape `resolveSwapperPipeline` accepts. */
function swapperDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: DEMO_ID,
    status: "CONFIRMED",
    network: "testnet",
    pipelineSnapshot: [
      { nodeId: "trigger-1", templateKind: "DEPOSIT_TRIGGER", contractAddress: "C".repeat(56) },
      { nodeId: "action-1", templateKind: "SWAPPER", contractAddress: "D".repeat(56) },
      { nodeId: "action-2", templateKind: "PAYER", contractAddress: "E".repeat(56) },
    ],
    ownerId: OWNER_ID,
    owner: { isActive: true, role: "USER" },
    ...overrides,
  };
}

// env() memoizes its parse, so the route is imported after the flags for the case are set.
async function post(body?: unknown) {
  vi.resetModules();
  const { POST } = await import("@/app/api/v1/demo-token/route");
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return POST(new Request("http://localhost/api/v1/demo-token", init) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ ok: true, remaining: 2, resetAt: 0, shared: true });
  mockDb.deployment.findUnique.mockResolvedValue(swapperDeployment());
  mockDb.deploymentApiToken.findMany.mockResolvedValue([]);
  mockDb.deploymentApiToken.updateMany.mockResolvedValue({ count: 0 });
  mockDb.deploymentApiToken.create.mockImplementation(async (args: { data: unknown }) => ({
    id: "token-row-1",
    tokenPrefix: (args.data as { tokenPrefix: string }).tokenPrefix,
    label: DEMO_TOKEN_LABEL,
    createdAt: new Date(),
    lastUsedAt: null,
    expiresAt: (args.data as { expiresAt: Date }).expiresAt,
    revokedAt: null,
  }));
  mockDb.$queryRaw.mockResolvedValue([{ id: DEMO_ID }]);
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
  process.env.DEMO_API_ENABLED = "true";
  process.env.DEMO_API_DEPLOYMENT_ID = DEMO_ID;
});

afterEach(() => {
  delete process.env.DEMO_API_ENABLED;
  delete process.env.DEMO_API_DEPLOYMENT_ID;
});

describe("POST /api/v1/demo-token — the gate", () => {
  it("is refused when DEMO_API_ENABLED is not set, without touching the database", async () => {
    delete process.env.DEMO_API_ENABLED;
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockDb.deployment.findUnique).not.toHaveBeenCalled();
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/demo-token — the happy path", () => {
  it("issues a 60-minute token bound to the configured deployment", async () => {
    const before = Date.now();
    const res = await post();
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: { deploymentId: string; token: string; expiresAt: string };
    };
    expect(Object.keys(body.data).sort()).toEqual(["deploymentId", "expiresAt", "token"]);
    expect(body.data.deploymentId).toBe(DEMO_ID);
    // The same pattern lib/api/v1/auth.ts checks before it touches the database.
    expect(body.data.token).toMatch(/^pfk_[0-9a-f]{64}$/);

    const ttl = new Date(body.data.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("stores the hash and never the plaintext, with no owning user", async () => {
    const res = await post();
    const body = (await res.json()) as { data: { token: string } };
    const { data } = mockDb.deploymentApiToken.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    expect(data.tokenHash).toBe(hashApiToken(body.data.token));
    expect(data.deploymentId).toBe(DEMO_ID);
    expect(data.label).toBe(DEMO_TOKEN_LABEL);
    // Null is half the discriminator protecting an operator's own token from eviction.
    expect(data.createdById).toBeNull();
    expect(JSON.stringify(data)).not.toContain(body.data.token);
  });

  it("locks the deployment row so concurrent mints serialize", async () => {
    await post();
    expect(mockDb.$transaction).toHaveBeenCalled();
    const sql = mockDb.$queryRaw.mock.calls[0]![0] as string[];
    expect(sql.join("?")).toContain("FOR NO KEY UPDATE");
  });

  it("audits the issue with the prefix and never the plaintext", async () => {
    const res = await post();
    const body = (await res.json()) as { data: { token: string } };

    const issued = mockAudit.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "API_DEMO_TOKEN_ISSUED",
    );
    expect(issued).toBeDefined();
    const opts = issued![0] as { userId: string; metadata: Record<string, unknown> };
    expect(opts.userId).toBe(OWNER_ID);
    expect(opts.metadata.deploymentId).toBe(DEMO_ID);
    expect(opts.metadata.tokenPrefix).toBe(body.data.token.slice(0, 12));
    expect(JSON.stringify(opts.metadata)).not.toContain(body.data.token);
    expect(JSON.stringify(opts.metadata)).not.toContain(hashApiToken(body.data.token));
  });

  it("ignores a request body: the deployment and the expiry are env-pinned", async () => {
    // The parameter-injection case — nothing a caller sends may widen the token.
    const res = await post({ deploymentId: OTHER_ID, expiresInDays: 365, label: "forever" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { deploymentId: string; expiresAt: string } };
    expect(body.data.deploymentId).toBe(DEMO_ID);
    expect(new Date(body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      61 * 60 * 1000,
    );

    const { data } = mockDb.deploymentApiToken.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.deploymentId).toBe(DEMO_ID);
    expect(data.label).toBe(DEMO_TOKEN_LABEL);
  });
});

describe("POST /api/v1/demo-token — abuse controls", () => {
  it("refuses when the per-IP cap is spent, before reading the deployment", async () => {
    mockRateLimit.mockImplementation(async (key: string) => ({
      ok: key !== "v1:demo-token:203.0.113.9",
      remaining: 0,
      resetAt: 0,
      shared: true,
    }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(mockDb.deployment.findUnique).not.toHaveBeenCalled();
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith("v1:demo-token:203.0.113.9", 3, 3600);
  });

  it("refuses when the instance-wide cap is spent", async () => {
    mockRateLimit.mockImplementation(async (key: string) => ({
      ok: key !== "v1:demo-token:global",
      remaining: 0,
      resetAt: 0,
      shared: true,
    }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith("v1:demo-token:global", 60, 3600);
  });

  it("refuses when the instance-wide cap has no shared limiter behind it", async () => {
    // rateLimit() degrades to a per-process bucket when Redis is unreachable. clientIp() trusts
    // the first X-Forwarded-For hop, so that cap is the only real bound on how many live
    // credentials this route can mint — it fails closed rather than trusting a per-replica count.
    mockRateLimit.mockImplementation(async (key: string) => ({
      ok: true,
      remaining: 0,
      resetAt: 0,
      shared: key !== "v1:demo-token:global",
    }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalled();
  });
});

describe("POST /api/v1/demo-token — an unusable demo deployment", () => {
  /** Every case here must be indistinguishable to the caller. */
  async function refusal(deployment: unknown) {
    mockDb.deployment.findUnique.mockResolvedValue(deployment);
    const res = await post();
    const body = (await res.json()) as { error: { code: string; message: string } };
    return { status: res.status, body };
  }

  it("gives a missing row and a pending deployment byte-identical refusals", async () => {
    const missing = await refusal(null);
    const pending = await refusal(swapperDeployment({ status: "PENDING" }));

    expect(missing.status).toBe(500);
    expect(pending.status).toBe(500);
    // No state oracle: an anonymous prober learns nothing about the demo deployment.
    expect(pending.body).toEqual(missing.body);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });

  it("refuses a non-swapper pipeline without leaking the internal reason", async () => {
    const { status, body } = await refusal(
      swapperDeployment({
        pipelineSnapshot: [
          { nodeId: "trigger-1", templateKind: "DEPOSIT_TRIGGER", contractAddress: "C".repeat(56) },
          { nodeId: "action-1", templateKind: "SPLITTER", contractAddress: "D".repeat(56) },
        ],
      }),
    );
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("swapper");
    expect(JSON.stringify(body)).not.toContain("SWAPPER");
    // The operator still gets the real reason.
    expect(mockLog.error).toHaveBeenCalled();
  });

  it("refuses a deployment on the other network", async () => {
    const { status } = await refusal(swapperDeployment({ network: "mainnet" }));
    expect(status).toBe(500);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });

  it("refuses when the owner is inactive", async () => {
    const { status } = await refusal(
      swapperDeployment({ owner: { isActive: false, role: "USER" } }),
    );
    expect(status).toBe(500);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });

  it("refuses when the owner is a sandbox identity", async () => {
    // requireDeploymentToken would 403 every call such a token made, so it is never issued.
    const { status } = await refusal(
      swapperDeployment({ owner: { isActive: true, role: "SANDBOX" } }),
    );
    expect(status).toBe(500);
    expect(mockDb.deploymentApiToken.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/demo-token — the cap evicts instead of refusing", () => {
  function liveTokens(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `demo-${i}` }));
  }

  it("serves the caller who arrives at the cap, revoking the oldest token", async () => {
    mockDb.deploymentApiToken.findMany.mockResolvedValue(liveTokens(DEMO_MAX_ACTIVE_TOKENS));
    const res = await post();

    // A 409 here would lock out the reviewer who arrived last.
    expect(res.status).toBe(201);
    expect(mockDb.deploymentApiToken.updateMany).toHaveBeenCalledTimes(1);
    const call = mockDb.deploymentApiToken.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: { revokedAt: Date };
    };
    expect(call.where.id.in).toEqual(["demo-0"]);
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });

  it("evicts nothing while there is headroom", async () => {
    mockDb.deploymentApiToken.findMany.mockResolvedValue(liveTokens(DEMO_MAX_ACTIVE_TOKENS - 1));
    const res = await post();
    expect(res.status).toBe(201);
    expect(mockDb.deploymentApiToken.updateMany).not.toHaveBeenCalled();
  });

  it("never considers a token an operator minted by hand on the demo deployment", async () => {
    await post();
    const { where } = mockDb.deploymentApiToken.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    // Both discriminators, or a stranger's request could revoke the operator's own credential.
    expect(where.label).toBe(DEMO_TOKEN_LABEL);
    expect(where.createdById).toBeNull();
    expect(where.deploymentId).toBe(DEMO_ID);
    expect(where.revokedAt).toBeNull();
  });

  it("records each eviction under the existing revoke action", async () => {
    mockDb.deploymentApiToken.findMany.mockResolvedValue(liveTokens(DEMO_MAX_ACTIVE_TOKENS));
    await post();

    const revoked = mockAudit.mock.calls
      .map((c) => c[0] as { action: string; metadata?: Record<string, unknown> })
      .filter((o) => o.action === "API_TOKEN_REVOKED");
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.metadata).toMatchObject({
      deploymentId: DEMO_ID,
      tokenId: "demo-0",
      reason: "demo-cap-evicted",
    });
  });
});
