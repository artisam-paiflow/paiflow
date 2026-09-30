/**
 * #524: the per-address guards `v1Route` runs before a token is looked up.
 *
 * The case they are designed around is ten hackathon teams behind one venue IP: one team's script
 * looping on a bad token must be counted, logged and eventually cut off from the database, without
 * costing any other team (or that team's own working token) a single request.
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
import { BLOCKED_MESSAGE, markTokenKnown } from "@/lib/api/v1/pre-auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { resetLimiterFallbackWarning } from "@/lib/rate-limit";
import { DEPLOYMENT_ID, ctx, newToken, tokenRow } from "./execute-fixtures";

const FAIL_LIMIT = V1_PRE_AUTH_LIMITS.failedAuth.limit;
const PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/events`;

/** Tokens the mocked table holds, by hash; anything else is unknown. */
const table = new Map<string, Record<string, unknown>>();

function issue(overrides: Record<string, unknown> = {}) {
  const token = newToken();
  table.set(hashApiToken(token.plaintext), { ...tokenRow(token), ...overrides });
  return token;
}

let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq}`;

function req(ip: string, authorization?: string): NextRequest {
  const headers = new Headers({ "x-forwarded-for": ip });
  if (authorization) headers.set("authorization", authorization);
  return new Request(`https://paiflow.test${PATH}`, { headers }) as unknown as NextRequest;
}

const handler = vi.fn(async () => NextResponse.json({ data: { ok: true } }));
// A per-token limit no test here reaches, so every 429 below is a pre-auth one.
const GET = v1Route({ rateLimit: { limit: 1_000_000, windowSeconds: 60 } }, handler);

const call = (ip: string, token?: { plaintext: string } | string) =>
  GET(
    req(ip, typeof token === "string" ? token : token ? `Bearer ${token.plaintext}` : undefined),
    ctx(),
  );

const badToken = () => newToken(); // well-formed, never issued

async function blockAddress(ip: string) {
  for (let i = 0; i < FAIL_LIMIT; i++) {
    const res = await call(ip, badToken());
    expect(res.status).toBe(401);
  }
}

const lookups = () => mockDb.deploymentApiToken.findUnique.mock.calls.length;
const warnings = (re: RegExp) => mockLog.warn.mock.calls.filter(([, msg]) => re.test(String(msg)));

/** incr/expire/ttl/get/set/exists over a Map, enough for the limiter and the known-token set. */
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

describe("failed authentications per address", () => {
  it("counts an unauthenticated flood and logs it: the first refusal, then the threshold", async () => {
    const ip = nextIp();
    await blockAddress(ip);

    const info = mockLog.info.mock.calls.filter(([, m]) => m === "v1: authentication refused");
    expect(info).toHaveLength(1);
    expect(info[0]![0]).toMatchObject({ ip, route: "/api/v1/deployments/:id/events", failures: 1 });
    const threshold = warnings(/failed-auth threshold reached/);
    expect(threshold).toHaveLength(1);
    expect(threshold[0]![0]).toMatchObject({ ip, failures: FAIL_LIMIT });
    // Every one of those was a real lookup: nothing was blocked before the threshold.
    expect(lookups()).toBe(FAIL_LIMIT);
    // The token itself is never logged.
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain("pfk_");
  });

  it("counts missing and malformed tokens too, which never reach the database", async () => {
    const ip = nextIp();
    for (let i = 0; i < FAIL_LIMIT / 2; i++) {
      expect((await call(ip)).status).toBe(401);
      expect((await call(ip, "Bearer pkdev_abc")).status).toBe(401);
    }
    expect(lookups()).toBe(0);
    expect((await call(ip, badToken())).status).toBe(429);
  });

  it("past the threshold, refuses an unknown token with 429 and no DB lookup", async () => {
    const ip = nextIp();
    await blockAddress(ip);
    const before = lookups();

    const res = await call(ip, badToken());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "RATE_LIMITED", message: BLOCKED_MESSAGE } });
    expect((await call(ip)).status).toBe(429);
    expect(lookups()).toBe(before);
    expect(handler).not.toHaveBeenCalled();
  });

  it("never costs a freshly minted token from the same address", async () => {
    const ip = nextIp();
    await blockAddress(ip);
    const minted = issue();
    // What both mint routes do before handing the plaintext out.
    await markTokenKnown(hashApiToken(minted.plaintext), null);

    const res = await call(ip, minted);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // The block is still there for the bad script.
    expect((await call(ip, badToken())).status).toBe(429);
  });

  it("never costs a token that has authenticated before, from any address", async () => {
    const venue = nextIp();
    const working = issue();
    expect((await call(nextIp(), working)).status).toBe(200);

    await blockAddress(venue);
    expect((await call(venue, working)).status).toBe(200);
    expect((await call(venue, working)).status).toBe(200);
  });

  it("still looks up a known token and refuses it once it is revoked", async () => {
    const ip = nextIp();
    const token = issue();
    expect((await call(ip, token)).status).toBe(200);
    await blockAddress(ip);

    table.set(hashApiToken(token.plaintext), { ...tokenRow(token), revokedAt: new Date() });
    const before = lookups();
    expect((await call(ip, token)).status).toBe(401);
    expect(lookups()).toBe(before + 1);
  });

  it("documents the residual: a real token neither minted nor used since this shipped is refused while its address is blocked", async () => {
    const ip = nextIp();
    const legacy = issue();
    await blockAddress(ip);
    expect((await call(ip, legacy)).status).toBe(429);
    // From an unblocked address it authenticates, which makes it known everywhere.
    expect((await call(nextIp(), legacy)).status).toBe(200);
    expect((await call(ip, legacy)).status).toBe(200);
  });

  it("is per address: a blocked address does not block another", async () => {
    const blocked = nextIp();
    await blockAddress(blocked);
    const before = lookups();
    expect((await call(nextIp(), badToken())).status).toBe(401);
    expect(lookups()).toBe(before + 1);
  });

  it("lapses with its window", async () => {
    const ip = nextIp();
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    await blockAddress(ip);
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
    expect((await call(ip, badToken())).status).toBe(401);
  });
});

describe("per-address backstop", () => {
  it(`admits ${V1_PRE_AUTH_LIMITS.ipBackstop.limit} requests a window from one address, then 429s and logs once`, async () => {
    const ip = nextIp();
    const token = issue();
    for (let i = 0; i < V1_PRE_AUTH_LIMITS.ipBackstop.limit; i++) {
      expect((await call(ip, token)).status).toBe(200);
    }
    const before = lookups();
    const res = await call(ip, token);
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("Too many requests from this address");
    await call(ip, token);
    expect(lookups()).toBe(before);
    expect(warnings(/per-address backstop reached/)).toHaveLength(1);

    // Another address is untouched.
    expect((await call(nextIp(), token)).status).toBe(200);
  });
});

describe("per-token limit is unchanged", () => {
  it("still 429s a token at its own limit, whatever the address allows", async () => {
    const GET2 = v1Route({ rateLimit: { limit: 2, windowSeconds: 60 } }, handler);
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
  it("keeps the failed-auth count and the known-token set in Redis", async () => {
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

    await blockAddress(ip);
    expect(client.store.get(`rl:v1:authfail:${ip}`)).toBe(String(FAIL_LIMIT));
    expect((await call(ip, badToken())).status).toBe(429);
    expect((await call(ip, token)).status).toBe(200);
    expect(warnings(/no shared Redis/)).toHaveLength(0);
  });

  it("when Redis is down, serves on per-process counts and says so, never failing closed", async () => {
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
    });
    const ip = nextIp();
    const token = issue();

    expect((await call(ip, token)).status).toBe(200);
    await blockAddress(ip);
    expect((await call(ip, badToken())).status).toBe(429);
    // Known from its earlier success in this process.
    expect((await call(ip, token)).status).toBe(200);

    // Throttled to one line a minute however many fallbacks there were.
    expect(warnings(/no shared Redis/)).toHaveLength(1);
    expect(warnings(/no shared Redis/)[0]![0]).toMatchObject({ reason: "error" });
  });
});
