import "server-only";
import { db } from "@/lib/db";
import type { AuditLogQuery } from "./schema";

export async function getAuditLogPage(query: AuditLogQuery) {
  const rows = await db.auditLog.findMany({
    where: {
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    include: { user: { select: { username: true } } },
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit).map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}

export type AuditLogPage = Awaited<ReturnType<typeof getAuditLogPage>>;
