import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { preparedDeploymentRecovery } from "@/lib/stellar/deployment-recovery";

const PatchSchema = z.object({
  distributeAmountStroops: z.string().regex(/^\d+$/),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id, serviceState: { not: "RETIRED" } },
      include: {
        flow: { select: { name: true, templateKind: true } },
        events: { orderBy: [{ ledger: "desc" }, { eventId: "desc" }], take: 50 },
      },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    if (deployment.serviceState === "RETIRING")
      return NextResponse.json({
        data: {
          id: deployment.id,
          serviceState: deployment.serviceState,
          retirementRequestedAt: deployment.retirementRequestedAt,
          retirementCutoffLedger: deployment.retirementCutoffLedger,
          retirementReconciledAt: deployment.retirementReconciledAt,
          retirementBlocker: deployment.retirementBlocker,
        },
      });
    return NextResponse.json({
      data: { ...deployment, preparedRecovery: await preparedDeploymentRecovery(deployment) },
    });
  });
}

async function PATCHHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("deploymentPatch", user.id);
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

export const PATCH = deploymentServiceRoute(PATCHHandler, "owner");
