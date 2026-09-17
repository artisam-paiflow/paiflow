import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb, mockRequireSession } = vi.hoisted(() => ({
  mockDb: { signedTransaction: { findMany: vi.fn() } },
  mockRequireSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));

import { GET } from "@/app/api/admin/signed-transactions/route";
import { AppError } from "@/lib/errors";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEP_ID = "11111111-1111-4111-8111-111111111111";

function req(query = ""): NextRequest {
  return new Request(
    `http://localhost/api/admin/signed-transactions${query}`,
  ) as unknown as NextRequest;
}

function row(n: number) {
  return {
    id: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
    txHash: String(n).padStart(64, "0"),
    signerAddress: ADDRESS,
    kind: "TRIGGER",
    network: "testnet",
    createdAt: new Date(2026, 8, 17, 0, 0, n),
    userId: null,
    deploymentId: DEP_ID,
    user: null,
    deployment: { id: DEP_ID, ownerId: USER_ID, flowId: DEP_ID },
  };
}

function lastWhere() {
  return mockDb.signedTransaction.findMany.mock.calls.at(-1)?.[0] as {
    where: Record<string, unknown>;
    take: number;
    skip?: number;
    cursor?: { id: string };
  };
}

describe("GET /api/admin/signed-transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue({ id: USER_ID, role: "ADMIN" });
    mockDb.signedTransaction.findMany.mockResolvedValue([]);
  });

  it("requires an admin session before touching the table", async () => {
    mockRequireSession.mockRejectedValue(new AppError("FORBIDDEN", "Admin only"));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockDb.signedTransaction.findMany).not.toHaveBeenCalled();
  });

  it("answers address → user with an exact signer filter", async () => {
    mockDb.signedTransaction.findMany.mockResolvedValue([row(1)]);
    const res = await GET(req(`?address=${ADDRESS}`));
    expect(res.status).toBe(200);
    expect(lastWhere().where).toEqual({ signerAddress: ADDRESS });
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.items[0].deployment.ownerId).toBe(USER_ID);
    expect(json.data.items[0].userId).toBeNull();
    expect(json.data.nextCursor).toBeNull();
  });

  it("answers user → addresses and tx hash → both, lowercasing the hash", async () => {
    await GET(req(`?userId=${USER_ID}`));
    expect(lastWhere().where).toEqual({ userId: USER_ID });

    const upper = "ABCDEF".repeat(10) + "ABCD";
    await GET(req(`?txHash=${upper}`));
    expect(lastWhere().where).toEqual({ txHash: upper.toLowerCase() });
  });

  it("rejects a malformed address, hash or id with a validation error", async () => {
    for (const query of [
      "?address=not-an-address",
      `?address=${ADDRESS.slice(0, 20)}`,
      "?txHash=abc",
      "?userId=42",
      "?limit=0",
      "?limit=201",
    ]) {
      const res = await GET(req(query));
      expect(res.status, query).toBe(422);
      expect((await res.json()).error.code, query).toBe("VALIDATION");
    }
    expect(mockDb.signedTransaction.findMany).not.toHaveBeenCalled();
  });

  it("pages with the last returned row as the cursor, never dropping one", async () => {
    mockDb.signedTransaction.findMany.mockResolvedValue([row(3), row(2), row(1)]);
    const res = await GET(req("?limit=2"));
    const json = await res.json();

    expect(lastWhere().take).toBe(3);
    expect(json.data.items.map((r: { id: string }) => r.id)).toEqual([row(3).id, row(2).id]);
    expect(json.data.nextCursor).toBe(row(2).id);

    await GET(req(`?limit=2&cursor=${row(2).id}`));
    expect(lastWhere().skip).toBe(1);
    expect(lastWhere().cursor).toEqual({ id: row(2).id });
  });
});
