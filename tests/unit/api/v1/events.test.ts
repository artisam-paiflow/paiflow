/**
 * `GET /api/v1/deployments/{id}/events` against the real Postgres the suite already uses (see
 * `tests/unit/setup.ts`), so the keyset condition is checked against the database's own ordering of
 * `eventId`, not a mock's.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// No Redis: the rate limit runs on its in-memory bucket.
vi.mock("@/lib/redis", () => ({ redis: () => null }));

import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { GET } from "@/app/api/v1/deployments/[id]/events/route";
import type { ContractEventItem } from "@/lib/api/v1/schema";

const suffix = crypto.randomBytes(4).toString("hex");
let userId: string;
let flowId: string;
let deploymentA: string;
let deploymentB: string;
let tokenA: string;
let tokenB: string;

const SWAP_TX = crypto.randomBytes(32).toString("hex");
const otherTx = () => crypto.randomBytes(32).toString("hex");

function request(deploymentId: string, query: string, token: string | null = tokenA) {
  return new Request(`http://localhost/api/v1/deployments/${deploymentId}/events${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;
}

async function call(deploymentId: string, query = "", token: string | null = tokenA) {
  const res = await GET(request(deploymentId, query, token), {
    params: Promise.resolve({ id: deploymentId }),
  });
  return { status: res.status, body: await res.json() };
}

async function mintToken(deploymentId: string): Promise<string> {
  const plaintext = `pfk_${crypto.randomBytes(32).toString("hex")}`;
  await db.deploymentApiToken.create({
    data: {
      deploymentId,
      createdById: userId,
      tokenHash: hashApiToken(plaintext),
      tokenPrefix: plaintext.slice(0, 12),
    },
  });
  return plaintext;
}

let seq = 0;
function event(
  deploymentId: string,
  ledger: number,
  opts: { txHash?: string; topic?: string; data?: object } = {},
) {
  seq += 1;
  return {
    deploymentId,
    eventId: `${suffix}-${String(ledger).padStart(10, "0")}-${String(seq).padStart(4, "0")}`,
    kind: "PAYOUT" as const,
    ledger,
    txHash: opts.txHash ?? otherTx(),
    payload: { topics: [opts.topic ?? "payout"], value: null },
    decodedData: opts.data ?? { amount: "1" },
    occurredAt: new Date(Date.UTC(2026, 8, 15, 0, 0, ledger % 60)),
  };
}

async function pageThrough(limit: number): Promise<{ items: ContractEventItem[]; cursor: string }> {
  const items: ContractEventItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const { status, body } = await call(
      deploymentA,
      `?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(status).toBe(200);
    items.push(...body.data.items);
    cursor = body.data.nextCursor;
    if (!body.data.hasMore) break;
  }
  if (!cursor) throw new Error("expected a cursor after the last page");
  return { items, cursor };
}

beforeAll(async () => {
  const user = await db.user.create({
    data: { username: `v1-events-${suffix}`, passwordHash: "hash" },
  });
  userId = user.id;
  const flow = await db.flow.create({
    data: {
      ownerId: userId,
      name: "v1 events",
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
  tokenA = await mintToken(deploymentA);
  tokenB = await mintToken(deploymentB);

  // Three rows share ledger 200 and two share 300, so pages must break inside a ledger.
  await db.contractEvent.createMany({
    data: [
      event(deploymentA, 300),
      event(deploymentA, 100, { topic: "receive" }),
      event(deploymentA, 200),
      event(deploymentA, 200, {
        txHash: SWAP_TX,
        topic: "swap",
        data: { assetIn: "XLM", assetOut: "USDC", amountIn: "100", amountOut: "12" },
      }),
      event(deploymentA, 200),
      event(deploymentA, 300),
      event(deploymentA, 400),
      event(deploymentB, 250),
    ],
  });
});

afterAll(async () => {
  // Events and tokens go with their deployments (onDelete: Cascade).
  await db.deployment.deleteMany({ where: { id: { in: [deploymentA, deploymentB] } } });
  await db.flow.deleteMany({ where: { id: flowId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("GET /api/v1/deployments/:id/events", () => {
  it("returns this deployment's events ascending by ledger then eventId", async () => {
    const { status, body } = await call(deploymentA);

    expect(status).toBe(200);
    const items: ContractEventItem[] = body.data.items;
    expect(items).toHaveLength(7);
    const keys = items.map((e) => [e.ledger, e.eventId] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    expect(keys).toEqual(sorted);
    expect(body.data.hasMore).toBe(false);
    expect(typeof body.data.nextCursor).toBe("string");

    const swap = items.find((e) => e.txHash === SWAP_TX);
    expect(swap).toMatchObject({
      kind: "PAYOUT",
      topic: "swap",
      ledger: 200,
      data: { assetIn: "XLM", assetOut: "USDC", amountIn: "100", amountOut: "12" },
    });
    expect(swap?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(swap ?? {}).sort()).toEqual(
      ["data", "eventId", "id", "kind", "ledger", "occurredAt", "topic", "txHash"].sort(),
    );
  });

  it("pages across rows sharing a ledger, and the pages union to the full set exactly once", async () => {
    const { body: full } = await call(deploymentA);
    const fullIds = full.data.items.map((e: ContractEventItem) => e.eventId);

    for (const limit of [1, 2, 3]) {
      const { items } = await pageThrough(limit);
      const ids = items.map((e) => e.eventId);
      expect(ids).toEqual(fullIds);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps the cursor on the tail, so the next poll returns only what arrived since", async () => {
    const { cursor } = await pageThrough(2);

    const empty = await call(deploymentA, `?cursor=${cursor}`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ items: [], nextCursor: cursor, hasMore: false });

    const arrived = event(deploymentA, 500, { topic: "swap" });
    await db.contractEvent.create({ data: arrived });

    const next = await call(deploymentA, `?cursor=${cursor}`);
    expect(next.body.data.items.map((e: ContractEventItem) => e.eventId)).toEqual([
      arrived.eventId,
    ]);
    const after = await call(deploymentA, `?cursor=${next.body.data.nextCursor}`);
    expect(after.body.data.items).toEqual([]);
  });

  it("filters by txHash, case-insensitively", async () => {
    const { status, body } = await call(deploymentA, `?txHash=${SWAP_TX.toUpperCase()}`);

    expect(status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].topic).toBe("swap");
  });

  it("returns null nextCursor only for an empty feed polled without a cursor", async () => {
    const { body } = await call(deploymentA, `?txHash=${"0".repeat(64)}`);
    expect(body.data).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["a non-numeric ledger", Buffer.from("abc|x").toString("base64url")],
    ["a negative ledger", Buffer.from("-1|x").toString("base64url")],
  ])("rejects a cursor with %s as 422", async (_name, cursor) => {
    const { status, body } = await call(deploymentA, `?cursor=${cursor}`);
    expect(status).toBe(422);
    expect(body.error).toMatchObject({
      code: "VALIDATION",
      fields: { cursor: ["Invalid cursor"] },
    });
  });

  it.each(["limit=0", "limit=101", "limit=abc", "txHash=abc", "unknown=1"])(
    "rejects %s as 422",
    async (query) => {
      const { status, body } = await call(deploymentA, `?${query}`);
      expect(status).toBe(422);
      expect(body.error.code).toBe("VALIDATION");
    },
  );

  it("never leaks another deployment's events", async () => {
    const { body } = await call(deploymentA, "?limit=100");
    expect(body.data.items.every((e: ContractEventItem) => e.ledger !== 250)).toBe(true);

    const own = await call(deploymentB, "", tokenB);
    expect(own.body.data.items.map((e: ContractEventItem) => e.ledger)).toEqual([250]);
  });

  it("refuses a token minted for another deployment, and a missing token", async () => {
    const wrong = await call(deploymentA, "", tokenB);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("UNAUTHENTICATED");

    const none = await call(deploymentA, "", null);
    expect(none.status).toBe(401);
  });
});
