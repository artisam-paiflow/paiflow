import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { submitDeployTx } from "@/lib/stellar/deploy";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = SubmitSchema.parse(await req.json());

    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    if (deployment.status !== "PENDING_SIGNATURE") {
      throw new AppError("CONFLICT", `Deployment is ${deployment.status}, cannot submit`);
    }

    await db.deployment.update({
      where: { id },
      data: { status: "SUBMITTED" },
    });
    await audit({ action: "DEPLOY_SUBMIT", userId: user.id, metadata: { deploymentId: id } });

    const result = await submitDeployTx(body.signedXdr);
    if (result.status === "SUCCESS") {
      // For pipeline deployments we trust the deterministic pre-computed
      // addresses stored in pipelineSnapshot.  For legacy single-contract
      // deployments we fall back to the address returned by the RPC.
      const pipeline = deployment.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;
      const contractAddress = pipeline?.[0]?.contractAddress ?? result.contractAddress ?? null;

      await db.deployment.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          deployTxHash: result.txHash,
          contractAddress,
          confirmedAt: new Date(),
        },
      });
      await audit({
        action: "DEPLOY_CONFIRM",
        userId: user.id,
        metadata: { deploymentId: id, txHash: result.txHash },
      });
      return NextResponse.json({
        data: {
          status: "CONFIRMED",
          txHash: result.txHash,
          contractAddress,
          pipeline: pipeline ?? undefined,
        },
      });
    }
    await db.deployment.update({
      where: { id },
      data: {
        status: "FAILED",
        deployTxHash: result.txHash,
        errorMessage: result.errorMessage,
      },
    });
    await audit({
      action: "DEPLOY_FAIL",
      userId: user.id,
      metadata: { deploymentId: id, error: result.errorMessage },
    });
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_RPC",
          message: result.errorMessage ?? "Deployment failed",
        },
      },
      { status: 502 },
    );
  });
}
