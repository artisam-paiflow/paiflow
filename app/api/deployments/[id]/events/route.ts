import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { deploymentEventResponse } from "@/lib/deployment-event-response";
import { AppError } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  return deploymentEventResponse(id, req.signal, () => pollEventsFor(id));
}
