import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";

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
    select: { status: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  return new Response(JSON.stringify({ status: deployment.status }), {
    headers: { "Content-Type": "application/json" },
  });
}
