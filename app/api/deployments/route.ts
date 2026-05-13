import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  flowId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const q = QuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const items = await db.deployment.findMany({
      where: {
        ownerId: user.id,
        ...(q.flowId ? { flowId: q.flowId } : {}),
        ...(q.status ? { status: q.status as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        contractAddress: true,
        status: true,
        network: true,
        createdAt: true,
        confirmedAt: true,
        flow: { select: { name: true, templateKind: true } },
      },
    });
    const nextCursor = items.length > q.limit ? items.pop()!.id : null;
    return NextResponse.json({ data: { items, nextCursor } });
  });
}
