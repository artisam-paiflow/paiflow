import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `submit-trigger:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = SubmitSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const isPipeline = pipeline != null && pipeline.length > 0;
    const triggerKind = pipeline?.[0]?.templateKind;
    const isWebhook = triggerKind === "WEBHOOK";

    if (!isPipeline && !isWebhook && d.flow.templateKind !== "SPLITTER") {
      throw new AppError(
        "VALIDATION",
        "Only splitter or webhook deployments support trigger submit",
      );
    }

    const result = await submitTriggerTx(body.signedXdr);
    if (result.status === "PENDING") {
      await audit({
        action: "DEPLOY_TRIGGER",
        userId: d.ownerId,
        metadata: { deploymentId: id, txHash: result.txHash },
      });
      return NextResponse.json({ data: { txHash: result.txHash, status: "PENDING" } });
    }
    if (result.status === "FAILED") {
      return NextResponse.json(
        { error: { code: "UPSTREAM_RPC", message: result.errorMessage ?? "Submission failed" } },
        { status: 502 },
      );
    }
    return NextResponse.json({ data: { txHash: result.txHash } });
  });
}
