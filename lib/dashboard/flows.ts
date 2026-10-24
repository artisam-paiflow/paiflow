import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const DashboardFlowQuerySchema = z.object({
  view: z.enum(["current", "retired"]).catch("current"),
  cursor: z.uuid().optional().catch(undefined),
});

export type DashboardFlowQuery = z.infer<typeof DashboardFlowQuerySchema>;

export async function dashboardFlows(ownerId: string, query: DashboardFlowQuery) {
  const where: Prisma.FlowWhereInput = {
    ownerId,
    ...(query.view === "retired"
      ? { deployments: { some: {}, every: { serviceState: "RETIRED" } } }
      : {
          OR: [
            { deployments: { none: {} } },
            { deployments: { some: { serviceState: { not: "RETIRED" } } } },
          ],
        }),
  };

  // A cursor must belong to this owner's selected view, including after a
  // retirement changes its classification between page requests.
  if (query.cursor) {
    const cursor = await db.flow.findFirst({
      where: { ...where, id: query.cursor },
      select: { id: true },
    });
    if (!cursor) return { items: [], nextCursor: null };
  }

  const items = await db.flow.findMany({
    where,
    select: {
      id: true,
      name: true,
      templateKind: true,
      updatedAt: true,
      _count: { select: { deployments: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 21,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > 20;
  if (hasMore) items.pop();
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}
