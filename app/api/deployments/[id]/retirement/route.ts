import { NextRequest, NextResponse } from "next/server";
import { RetireDeploymentSchema } from "@/lib/deployments/service-schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { requestRetirement, reconcileRetirement } from "@/lib/deployments/retirement";
import { isUuid } from "@/lib/api/v1/handler";

async function owned(id: string, ownerId: string) {
  if (!isUuid(id)) throw new AppError("NOT_FOUND", "Deployment not found");
  const row = await db.deployment.findFirst({
    where: { id, ownerId, serviceState: { not: "RETIRED" } },
    select: {
      id: true,
      serviceState: true,
      retirementRequestedAt: true,
      retiredAt: true,
      retirementCutoffLedger: true,
      retirementReconciledAt: true,
      retirementBlocker: true,
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Deployment not found");
  return row;
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("deploymentRetirement", user.id);
    const { id } = await ctx.params;
    await owned(id, user.id);
    RetireDeploymentSchema.parse(await req.json());
    await requestRetirement(id, user.id);
    await reconcileRetirement(id);
    const row = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      select: { serviceState: true, retirementBlocker: true },
    });
    return NextResponse.json({ data: row });
  });
}
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("deploymentStatus", user.id);
    const { id } = await ctx.params;
    return NextResponse.json({ data: await owned(id, user.id) });
  });
}
