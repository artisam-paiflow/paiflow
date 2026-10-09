import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { clientIp } from "@/lib/rate-limit";
import { parseReleaseBody, releaseTimelockBranchBefore } from "@/lib/timelock-early-release";

/**
 * The owner's "Release now" (#751): pay a timelock branch's before side ahead of
 * its deadline, signed by the relayer. Owner session only; the partner API
 * equivalent is `/api/v1/deployments/:id/release-early`. Not on the sandbox
 * allowlist (`lib/sandbox-paths.ts`): a sandbox account cannot deploy this kind.
 */
async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) {
      throw new AppError("NOT_FOUND", "Deployment not found");
    }
    await enforceWriteRateLimit("timelockRelease", `${user.id}:${id}`);
    const input = await parseReleaseBody(req);

    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, status: true, pipelineSnapshot: true },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    const released = await releaseTimelockBranchBefore(deployment, input.nodeId);

    await audit({
      action: "TIMELOCK_RELEASE_BEFORE",
      userId: user.id,
      ip: clientIp(req),
      metadata: { deploymentId: id, nodeId: released.nodeId, txHash: released.txHash },
    });

    return NextResponse.json({
      data: { nodeId: released.nodeId, txHash: released.txHash, ledger: released.ledger },
    });
  });
}

export const POST = deploymentServiceRoute(POSTHandler, "owner");
