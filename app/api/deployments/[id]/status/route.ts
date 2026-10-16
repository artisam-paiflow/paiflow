import { NextRequest } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/api/v1/handler";
import { AppError, withErrorHandler } from "@/lib/errors";
import { reconcileOwnerDeployment } from "@/lib/deployments/reconcile-owner-deployment";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function GETHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    // Before the limiter: the id is part of its key, and only a real one may mint a bucket.
    if (!isUuid(id)) throw new AppError("NOT_FOUND", "Deployment not found");
    await enforceWriteRateLimit("deploymentStatusUser", user.id);
    await enforceWriteRateLimit("deploymentStatus", `${user.id}:${id}`);
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    await reconcileOwnerDeployment(deployment);
    const current = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      select: { status: true, deployTxHash: true },
    });
    if (!current) throw new AppError("NOT_FOUND", "Deployment not found");

    return new Response(JSON.stringify({ status: current.status, txHash: current.deployTxHash }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}

export const GET = deploymentServiceRoute(GETHandler, "owner");
