import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb, mockRequireSession } = vi.hoisted(() => ({
  mockDb: { auditLog: { findMany: vi.fn() } },
  mockRequireSession: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));

import { GET } from "@/app/api/admin/audit-log/route";
import { AppError } from "@/lib/errors";
import { AuditLogQuerySchema } from "@/lib/admin/audit-log/schema";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function request(query = ""): NextRequest {
  return new Request(`http://localhost/api/admin/audit-log${query}`) as NextRequest;
}
function row(index: number) {
  return {
    id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    userId: null,
    action: "USER_LOGIN",
    ip: null,
    userAgent: null,
    metadata: null,
    user: null,
    // All entries intentionally share a timestamp: IDs must break the tie.
    createdAt: new Date("2026-10-25T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ id: USER_ID, role: "ADMIN" });
  mockDb.auditLog.findMany.mockResolvedValue([]);
});

describe("admin audit log", () => {
  it.each(["UNAUTHENTICATED", "FORBIDDEN"] as const)("rejects %s before querying", async (code) => {
    mockRequireSession.mockRejectedValue(new AppError(code, "Access denied"));
    const response = await GET(request());
    expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403);
    expect(mockRequireSession).toHaveBeenCalledWith({ role: "ADMIN" });
    expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
  });

  it.each([0, 1, 20, 21, 40, 41])(
    "returns every tied-timestamp event exactly once across %i records",
    async (count) => {
      const records = Array.from({ length: count }, (_, index) => row(count - index));
      mockDb.auditLog.findMany.mockImplementation(async (query) => {
        expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
        expect(query.take).toBe(21);
        const start = query.cursor
          ? records.findIndex((item) => item.id === query.cursor.id) + query.skip
          : 0;
        return records.slice(start, start + query.take);
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await GET(request(cursor ? `?cursor=${cursor}` : ""));
        expect(response.status).toBe(200);
        const { data } = await response.json();
        expect(data.items.length).toBeLessThanOrEqual(20);
        if (data.nextCursor) expect(data.nextCursor).toBe(data.items.at(-1).id);
        for (const item of data.items) {
          seen.push(item.id);
          expect(item.createdAt).toBe("2026-10-25T00:00:00.000Z");
        }
        cursor = data.nextCursor;
        expect(mockDb.auditLog.findMany.mock.calls.length).toBeLessThanOrEqual(3);
      } while (cursor);
      expect(seen).toEqual(records.map((item) => item.id));
    },
  );

  it("preserves exact action/user filters", async () => {
    await GET(request(`?action=USER_LOGIN&userId=${USER_ID}&limit=100`));
    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "USER_LOGIN", userId: USER_ID },
        take: 101,
      }),
    );
  });

  it.each(["?cursor=bad", "?userId=bad", "?limit=0", "?limit=101", "?limit=1.5", "?limit=NaN"])(
    "rejects invalid query %s",
    async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(422);
      expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
    },
  );

  it("parses valid defaults and boundary values", () => {
    expect(AuditLogQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(AuditLogQuerySchema.parse({ cursor: USER_ID, limit: "1" })).toEqual({
      cursor: USER_ID,
      limit: 1,
    });
    expect(AuditLogQuerySchema.parse({ limit: "100" }).limit).toBe(100);
  });
});
