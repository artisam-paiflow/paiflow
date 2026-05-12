import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: {
        flow: { select: { name: true, templateKind: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 50 },
      },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    return NextResponse.json({ data: deployment });
  });
}
