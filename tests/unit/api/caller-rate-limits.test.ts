vi.mock("@/lib/analytics/wallet-connections", () => ({
  recordWalletConnection: vi.fn(async (input) => ({
    ok: true,
    created: true,
    connectionId: input.connectionId,
  })),
}));
/**
 * #725: `balances` and `poll-events` were keyed on the caller's IP alone, so
 * one venue Wi-Fi shared one bucket and ten open deployment tabs 429'd live
 * balances for the whole room. They now key on deployment + user, under a much
 * looser address-wide backstop; `audit/wallet-connection` keys on the user when
 * there is one and falls back to the address for a guest.
 *
 * `lib/rate-limit.ts` runs for real on its in-memory fallback (no Redis). Its
 * buckets live for the module's lifetime, so every test uses its own address.
 */
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";

const { mockDb, mockSession } = vi.hoisted(() => ({
  mockDb: {
    deployment: { findFirst: vi.fn() },
    contractEvent: { findMany: vi.fn() },
  },
  mockSession: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ getSessionUser: mockSession }));
vi.mock("@/lib/stellar/balances", () => ({
  getWorkflowBalances: vi.fn(async () => ({ totals: [], nodes: [] })),
}));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: vi.fn(async () => 0) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { GET as balances } from "@/app/api/deployments/[id]/balances/route";
import { GET as pollEvents } from "@/app/api/deployments/[id]/poll-events/route";
import { POST as walletConnect } from "@/app/api/audit/wallet-connection/route";
import { CALLER_RATE_LIMITS, rateLimitSubject } from "@/lib/rate-limit";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const routes = [
  ["balances", balances as Handler, CALLER_RATE_LIMITS.balances],
  ["poll-events", pollEvents as Handler, CALLER_RATE_LIMITS.pollEvents],
] as const;

let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;
const user = (id = crypto.randomUUID()) => ({ id, username: "u", role: "USER" });

function get(route: string, id: string, ip: string) {
  return new NextRequest(`http://localhost/api/deployments/${id}/${route}`, {
    headers: { "x-forwarded-for": ip },
  });
}

async function call(name: string, handler: Handler, id: string, ip: string, as: unknown) {
  mockSession.mockResolvedValueOnce(as);
  return handler(get(name, id, ip), { params: Promise.resolve({ id }) });
}

async function burn(
  name: string,
  handler: Handler,
  n: number,
  id: string,
  ip: string,
  as: unknown,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await call(name, handler, id, ip, as)).status);
  return statuses;
}

beforeEach(() => {
  vi.clearAllMocks();
  // A request refused by a backstop that runs before getSessionUser() leaves
  // its queued session unconsumed; drop it so it cannot leak into the next test.
  mockSession.mockReset();
  mockDb.deployment.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    status: "CONFIRMED",
    contractAddress: "C".padEnd(56, "A"),
    flow: { templateKind: "SPLITTER" },
  }));
  mockDb.contractEvent.findMany.mockResolvedValue([]);
});

describe("rateLimitSubject", () => {
  it("keys a signed-in caller on the user and a guest on the address", () => {
    expect(rateLimitSubject({ id: "u1" }, "203.0.113.1")).toBe("user:u1");
    expect(rateLimitSubject(null, "203.0.113.1")).toBe("ip:203.0.113.1");
  });
});

for (const [name, handler, limits] of routes) {
  describe(`${name} rate limits (#725)`, () => {
    it("gives two users on the same IP separate buckets", async () => {
      const ip = freshIp();
      const id = crypto.randomUUID();
      const alice = user();
      const bob = user();
      const first = await burn(name, handler, limits.perCaller.limit + 1, id, ip, alice);
      expect(first.slice(0, -1).every((s) => s === 200)).toBe(true);
      expect(first.at(-1)).toBe(429);
      expect((await call(name, handler, id, ip, bob)).status).toBe(200);
    });

    it("gives the same user separate buckets on two deployments", async () => {
      const ip = freshIp();
      const alice = user();
      const a = crypto.randomUUID();
      const b = crypto.randomUUID();
      const statuses = await burn(name, handler, limits.perCaller.limit + 1, a, ip, alice);
      expect(statuses.at(-1)).toBe(429);
      expect((await call(name, handler, b, ip, alice)).status).toBe(200);
    });

    it("still trips the per-IP backstop at its limit, across users and deployments", async () => {
      const ip = freshIp();
      for (let i = 0; i < limits.ipBackstop.limit; i++) {
        const res = await call(name, handler, crypto.randomUUID(), ip, user());
        expect(res.status).toBe(200);
      }
      expect((await call(name, handler, crypto.randomUUID(), ip, user())).status).toBe(429);
      // Another address is unaffected.
      expect((await call(name, handler, crypto.randomUUID(), freshIp(), user())).status).toBe(200);
    });

    it("refuses a guest before touching any bucket or the database", async () => {
      const res = await call(name, handler, crypto.randomUUID(), freshIp(), null);
      expect(res.status).toBe(401);
      expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
    });

    it("answers 404 for a non-uuid id without querying, so it mints no bucket", async () => {
      const res = await call(name, handler, "not-a-uuid", freshIp(), user());
      expect(res.status).toBe(404);
      expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
    });

    it("answers 404 for a deployment the caller does not own, and spends none of its bucket", async () => {
      const ip = freshIp();
      const id = crypto.randomUUID();
      const alice = user();
      for (let i = 0; i < limits.perCaller.limit; i++) {
        mockDb.deployment.findFirst.mockResolvedValueOnce(null);
        expect((await call(name, handler, id, ip, alice)).status).toBe(404);
      }
      // Had the 404s counted, this would be request limit + 1 on the bucket.
      expect((await call(name, handler, id, ip, alice)).status).toBe(200);
    });

    it("checks the IP backstop before the ownership lookup", async () => {
      const ip = freshIp();
      for (let i = 0; i < limits.ipBackstop.limit; i++) {
        await call(name, handler, crypto.randomUUID(), ip, user());
      }
      mockDb.deployment.findFirst.mockClear();
      expect((await call(name, handler, crypto.randomUUID(), ip, user())).status).toBe(429);
      expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
    });

    it("keys a SANDBOX-role user on the user like any other", async () => {
      const ip = freshIp();
      const id = crypto.randomUUID();
      const visitor = { ...user(), role: "SANDBOX" };
      const statuses = await burn(name, handler, limits.perCaller.limit + 1, id, ip, visitor);
      expect(statuses.at(-1)).toBe(429);
      expect((await call(name, handler, id, ip, user())).status).toBe(200);
    });
  });
}

describe("audit/wallet-connection rate limits (#725)", () => {
  const body = {
    address: Keypair.random().publicKey(),
    network: "testnet",
    walletId: "freighter",
    surface: "trigger",
  };
  const post = (ip: string, as: unknown) => {
    mockSession.mockResolvedValueOnce(as);
    return walletConnect(
      new NextRequest("http://localhost/api/audit/wallet-connection", {
        method: "POST",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          connectionId: crypto.randomUUID(),
          sessionUserId: as && typeof as === "object" && "id" in as ? as.id : null,
        }),
      }),
    );
  };
  const { perCaller, ipBackstop } = CALLER_RATE_LIMITS.walletConnect;

  it("still trips the per-IP backstop across signed-in users", async () => {
    const ip = freshIp();
    for (let i = 0; i < ipBackstop.limit; i++) expect((await post(ip, user())).status).toBe(200);
    expect((await post(ip, user())).status).toBe(429);
  });

  it("gives two signed-in users on the same IP separate buckets", async () => {
    const ip = freshIp();
    const alice = user();
    for (let i = 0; i < perCaller.limit; i++) expect((await post(ip, alice)).status).toBe(200);
    expect((await post(ip, alice)).status).toBe(429);
    expect((await post(ip, user())).status).toBe(200);
  });

  it("falls back to the address for guests, so guests on one IP share a bucket", async () => {
    const ip = freshIp();
    for (let i = 0; i < perCaller.limit; i++) expect((await post(ip, null)).status).toBe(200);
    expect((await post(ip, null)).status).toBe(429);
    // A signed-in user behind the same address is not caught by the guests' bucket.
    expect((await post(ip, user())).status).toBe(200);
  });
});
