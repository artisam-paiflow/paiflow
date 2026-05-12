import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { Role } from "@prisma/client";

const Query = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().optional(),
  userId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
    const items = await db.auditLog.findMany({
      where: {
        ...(q.action ? { action: q.action } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: { user: { select: { username: true } } },
    });
    const nextCursor = items.length > q.limit ? items.pop()!.id : null;
    return NextResponse.json({ data: { items, nextCursor } });
  });
}
