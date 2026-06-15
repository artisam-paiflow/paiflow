import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { z } from "zod";
import { audit } from "@/lib/audit";

const PatchSchema = z.object({
  distributeAmountStroops: z.string().regex(/^\d+$/),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: {
        flow: { select: { name: true, templateKind: true } },
        events: { orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }], take: 50 },
      },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    return NextResponse.json({ data: deployment });
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = PatchSchema.parse(await req.json());
    const deployment = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    const updated = await db.deployment.update({
      where: { id },
      data: {
        distributeAmountStroops: body.distributeAmountStroops,
      },
    });
    await audit({
      action: "DEPLOY_AMOUNT_CHANGE",
      userId: user.id,
      metadata: { deploymentId: id, amount: body.distributeAmountStroops },
    });
    return NextResponse.json({ data: updated });
  });
}
