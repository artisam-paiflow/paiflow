// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
/**
 * #524: the per-address guards `v1Route` runs before a token is looked up.
 *
 * The case they are designed around is ten hackathon teams behind one venue IP: one team's script
 * looping on a bad token must be counted, logged and kept off the database, without costing any
 * other team (or that team's own working token) a single request.
 *
 * Auth runs for real (`requireDeploymentToken` against a mocked token table), so "no DB lookup" is
 * asserted on `findUnique` itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const { mockDb, mockRedis, mockLog } = vi.hoisted(() => ({
  mockDb: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  mockRedis: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/redis", () => ({ redis: mockRedis }));
vi.mock("@/lib/log", () => ({ log: mockLog }));

import { v1Route } from "@/lib/api/v1/handler";
import { V1_PRE_AUTH_LIMITS } from "@/lib/api/v1/limits";
import { BLOCKED_MESSAGE, REFUSED_TOKEN_TTL_SECONDS, markTokenKnown } from "@/lib/api/v1/pre-auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { resetLimiterFallbackWarning } from "@/lib/rate-limit";
import { DEPLOYMENT_ID, ctx, newToken, tokenRow } from "./execute-fixtures";

const FAIL_LIMIT = V1_PRE_AUTH_LIMITS.failedAuth.limit;
const BUDGET = V1_PRE_AUTH_LIMITS.blockedLookups.limit;
const BACKSTOP = V1_PRE_AUTH_LIMITS.ipBackstop.limit;
const PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;
const GENERIC_401 = "A valid API token for this deployment is required";

/** Tokens the mocked table holds, by hash; anything else is unknown. */
const table = new Map<string, Record<string, unknown>>();

function issue(overrides: Record<string, unknown> = {}) {
  const token = newToken();
  table.set(hashApiToken(token.plaintext), { ...tokenRow(token), ...overrides });
  return token;
}

let ipSeq = 0;
const nextIp = () => `203.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

function req(ip: string, authorization?: string): NextRequest {
  const headers = new Headers({ "x-forwarded-for": ip });
  if (authorization) headers.set("authorization", authorization);
  return new Request(`https://paiflow.test${PATH}`, { headers }) as unknown as NextRequest;
}

const handler = vi.fn(async () => NextResponse.json({ data: { ok: true } }));
// A per-token limit no test here reaches, so every 429 below is a pre-auth one.
const GET = v1Route(
  { operation: "GET events", rateLimit: { limit: 1_000_000, windowSeconds: 60 } },
  handler,
);

const call = (ip: string, token?: { plaintext: string } | string) =>
  GET(
    req(ip, typeof token === "string" ? token : token ? `Bearer ${token.plaintext}` : undefined),
    ctx(),
  );

const badToken = () => newToken(); // well-formed, never issued

/** Push an address past the failed-auth threshold with missing tokens, which cost no lookup. */
async function blockAddress(ip: string) {
  for (let i = 0; i < FAIL_LIMIT; i++) expect((await call(ip)).status).toBe(401);
}

/** Spend a blocked address's lookup budget with distinct guessed tokens. */
async function spendBudget(ip: string) {
  for (let i = 0; i < BUDGET; i++) expect((await call(ip, badToken())).status).toBe(401);
}

const lookups = () => mockDb.deploymentApiToken.findUnique.mock.calls.length;
const warnings = (re: RegExp) => mockLog.warn.mock.calls.filter(([, msg]) => re.test(String(msg)));

/** incr/expire/ttl/get/set/exists/del over a Map, enough for the limiter and the token flags. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    incr: vi.fn(async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 60),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => (store.set(k, v), "OK")),
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetLimiterFallbackWarning();
  mockRedis.mockReturnValue(null);
  mockDb.deploymentApiToken.update.mockResolvedValue({});
  mockDb.deploymentApiToken.findUnique.mockImplementation(
    async ({ where }: { where: { tokenHash: string } }) => table.get(where.tokenHash) ?? null,
  );
});

describe("failed authentications are counted and logged", () => {
  it("logs the first refusal and the threshold, never the token", async () => {
    const ip = nextIp();
    for (let i = 0; i < FAIL_LIMIT; i++) {
      expect((await call(ip, i % 2 ? badToken() : undefined)).status).toBe(401);
    }

    const info = mockLog.info.mock.calls.filter(([, m]) => m === "v1: authentication refused");
    expect(info).toHaveLength(1);
    expect(info[0]![0]).toMatchObject({ ip, route: "/api/v1/deployments/:id/events", failures: 1 });
    const threshold = warnings(/failed-auth threshold reached/);
    expect(threshold).toHaveLength(1);
    expect(threshold[0]![0]).toMatchObject({ ip, failures: FAIL_LIMIT });
    expect(JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls])).not.toMatch(
      /pfk_|[0-9a-f]{32}/,
    );
  });

  it("missing and malformed tokens never reach the database", async () => {
    const ip = nextIp();
    expect((await call(ip)).status).toBe(401);
    expect((await call(ip, "Bearer pkdev_abc")).status).toBe(401);
    expect(lookups()).toBe(0);
  });
});

describe("a script looping on one bad token", () => {
  it("costs one lookup a minute, still answered with the generic 401", async () => {
    const ip = nextIp();
    const bad = badToken();
    for (let i = 0; i < 50; i++) {
      const res = await call(ip, bad);
      expect(res.status).toBe(401);
      expect((await res.json()).error.message).toBe(GENERIC_401);
    }
    expect(lookups()).toBe(1);
  });

  it("gets its lookup again once the refusal lapses", async () => {
    const ip = nextIp();
    const bad = badToken();
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    await call(ip, bad);
    await call(ip, bad);
    expect(lookups()).toBe(1);
    now.mockReturnValue(start + REFUSED_TOKEN_TTL_SECONDS * 1000 + 1);
    await call(ip, bad);
    expect(lookups()).toBe(2);
  });

  it("a revoked token that used to work is forgotten, then answered without a lookup", async () => {
    const ip = nextIp();
    const token = issue();
    expect((await call(ip, token)).status).toBe(200);
    table.set(hashApiToken(token.plaintext), { ...tokenRow(token), revokedAt: new Date() });

    const before = lookups();
    for (let i = 0; i < 20; i++) expect((await call(ip, token)).status).toBe(401);
    expect(lookups()).toBe(before + 1);
  });

  it("never touches the other teams on the address", async () => {
    const venue = nextIp();
    const working = issue();
    expect((await call(venue, working)).status).toBe(200);
    const bad = badToken();
    for (let i = 0; i < FAIL_LIMIT * 2; i++) await call(venue, bad);
    expect((await call(venue, working)).status).toBe(200);
    // Even a working token never seen before still gets through: the loop spent no budget.
    expect((await call(venue, issue())).status).toBe(200);
  });
});

describe("a random-token flood from one address", () => {
  it("past the threshold, gets a budget of lookups and then 429s with none", async () => {
    const ip = nextIp();
    await blockAddress(ip);
    await spendBudget(ip);
    const before = lookups();

    const res = await call(ip, badToken());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "RATE_LIMITED", message: BLOCKED_MESSAGE } });
    expect(lookups()).toBe(before);
    expect(handler).not.toHaveBeenCalled();
  });

  it("never costs a freshly minted token from the same address", async () => {
    const ip = nextIp();
    await blockAddress(ip);
    await spendBudget(ip);
    const minted = issue();
    // What both mint routes do before handing the plaintext out.
    await markTokenKnown(hashApiToken(minted.plaintext), null);

    expect((await call(ip, minted)).status).toBe(200);
    expect((await call(ip, badToken())).status).toBe(429);
  });

  it("never costs a token that has authenticated before, from any address", async () => {
    const venue = nextIp();
    const working = issue();
    expect((await call(nextIp(), working)).status).toBe(200);

    await blockAddress(venue);
    await spendBudget(venue);
    expect((await call(venue, working)).status).toBe(200);
  });

  it("a real token never seen by this instance gets through while budget remains", async () => {
    const ip = nextIp();
    await blockAddress(ip);
    expect((await call(ip, issue())).status).toBe(200);
  });

  it("documents the residual: a never-seen real token is caught once the flood spends the budget", async () => {
    const ip = nextIp();
    const legacy = issue();
    await blockAddress(ip);
    await spendBudget(ip);
    expect((await call(ip, legacy)).status).toBe(429);
    // From anywhere else it authenticates, which makes it known everywhere.
    expect((await call(nextIp(), legacy)).status).toBe(200);
    expect((await call(ip, legacy)).status).toBe(200);
  });

  it("is per address", async () => {
    const blocked = nextIp();
    await blockAddress(blocked);
    await spendBudget(blocked);
    expect((await call(nextIp(), badToken())).status).toBe(401);
  });

  it("lapses with the failed-auth window", async () => {
    const ip = nextIp();
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    await blockAddress(ip);
    await spendBudget(ip);
    expect((await call(ip, badToken())).status).toBe(429);

    now.mockReturnValue(start + V1_PRE_AUTH_LIMITS.failedAuth.windowSeconds * 1000 + 1);
    expect((await call(ip, badToken())).status).toBe(401);
  });

  it("does not count a 404 for a malformed deployment id", async () => {
    const ip = nextIp();
    for (let i = 0; i < FAIL_LIMIT; i++) {
      const res = await GET(req(ip, `Bearer ${badToken().plaintext}`), ctx("not-a-uuid"));
      expect(res.status).toBe(404);
    }
    await spendBudget(ip);
    expect((await call(ip, badToken())).status).toBe(401);
  });
});

describe("per-address backstop on lookups of unseen tokens", () => {
  it(`admits ${BACKSTOP} a window, then 429s without a lookup and logs once`, async () => {
    const ip = nextIp();
    // Fresh real tokens: each is unseen until its own first success, and none fails, so this
    // exercises the backstop alone, not the failed-auth threshold.
    for (let i = 0; i < BACKSTOP; i++) expect((await call(ip, issue())).status).toBe(200);
    const before = lookups();
    const res = await call(ip, issue());
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("Too many requests from this address");
    await call(ip, badToken());
    expect(lookups()).toBe(before);
    expect(warnings(/per-address backstop/)).toHaveLength(1);
  });

  it("a flood that spends the backstop never refuses a known token on the same address", async () => {
    const ip = nextIp();
    const working = issue();
    expect((await call(ip, working)).status).toBe(200);
    // One script, a tight loop, a fresh unseen token each time: spends the backstop and the
    // failed-auth threshold together.
    for (let i = 0; i <= BACKSTOP; i++) await call(ip, badToken());
    expect((await call(ip, badToken())).status).toBe(429);

    const res = await call(ip, working);
    expect(res.status).toBe(200);
  });
});

describe("per-token limit is unchanged", () => {
  it("still 429s a token at its own limit, whatever the address allows", async () => {
    const GET2 = v1Route(
      { operation: "GET events", rateLimit: { limit: 2, windowSeconds: 60 } },
      handler,
    );
    const token = issue();
    const ip = nextIp();
    const r = () => GET2(req(ip, `Bearer ${token.plaintext}`), ctx());
    expect((await r()).status).toBe(200);
    expect((await r()).status).toBe(200);
    const res = await r();
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("Too many requests");
  });
});

describe("with Redis", () => {
  it("keeps the counts and the token flags in Redis, keyed on a hash prefix", async () => {
    const client = fakeRedis();
    mockRedis.mockReturnValue(client);
    const ip = nextIp();
    const token = issue();
    expect((await call(nextIp(), token)).status).toBe(200);
    // The success marks the token known, unawaited; let it land.
    await new Promise((r) => setImmediate(r));
    expect(client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^v1:tok-known:[0-9a-f]{32}$/),
      "1",
      "EX",
      expect.any(Number),
    );

    const bad = badToken();
    await call(ip, bad);
    expect([...client.store.keys()]).toContainEqual(
      expect.stringMatching(new RegExp(`^v1:tok-refused:[0-9a-f]{32}:${DEPLOYMENT_ID}$`)),
    );
    await blockAddress(ip);
    expect(Number(client.store.get(`rl:v1:authfail:${ip}`))).toBe(FAIL_LIMIT + 1);
    expect((await call(ip, token)).status).toBe(200);
    expect(warnings(/no shared Redis/)).toHaveLength(0);
  });

  it("when Redis is down, serves on per-process state and says so, never failing closed", async () => {
    const down = async () => {
      throw new Error("connection refused");
    };
    mockRedis.mockReturnValue({
      incr: down,
      expire: down,
      ttl: down,
      get: down,
      set: down,
      exists: down,
      del: down,
    });
    const ip = nextIp();
    const token = issue();

    expect((await call(ip, token)).status).toBe(200);
    await blockAddress(ip);
    await spendBudget(ip);
    expect((await call(ip, badToken())).status).toBe(429);
    // Known from its earlier success in this process.
    expect((await call(ip, token)).status).toBe(200);

    // Throttled to one line a minute however many fallbacks there were.
    expect(warnings(/no shared Redis/)).toHaveLength(1);
    expect(warnings(/no shared Redis/)[0]![0]).toMatchObject({ reason: "error" });
  });
});
