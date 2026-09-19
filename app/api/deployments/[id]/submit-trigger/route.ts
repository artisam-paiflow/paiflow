import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { stellarPassphrase } from "@/lib/env";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { signerFromSignedXdr } from "@/lib/stellar/signer";
import { recordSignedTransaction } from "@/lib/signed-tx";
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
    const isStreamer = d.flow.templateKind === "STREAMER";

    if (!isPipeline && !isWebhook && d.flow.templateKind !== "SPLITTER" && !isStreamer) {
      throw new AppError(
        "VALIDATION",
        "Only splitter, webhook, or streamer deployments support trigger submit",
      );
    }

    // Recorded before the chain call, under the signer's own session if any.
    // This route is public, so the signer is often not the owner and often
    // has no session at all; `d.ownerId` is never substituted for them.
    const signer = signerFromSignedXdr(body.signedXdr, stellarPassphrase());
    const sessionUser = await getSessionUser();
    await recordSignedTransaction({
      signer,
      kind: "TRIGGER",
      network: d.network,
      userId: sessionUser?.id ?? null,
      deploymentId: id,
      ip,
    });

    const result = await submitTriggerTx(body.signedXdr);
    if (result.status === "PENDING") {
      // `tx-status` runs its confirmation bookkeeping off this row, one per
      // hash: a duplicate send means an earlier request already wrote it.
      if (!result.duplicate) {
        await audit({
          action: "DEPLOY_TRIGGER",
          userId: d.ownerId,
          metadata: {
            deploymentId: id,
            txHash: result.txHash,
            signerAddress: signer.ok ? signer.signerAddress : null,
          },
        });
      }
      return NextResponse.json({ data: { txHash: result.txHash, status: "PENDING" } });
    }
    if (result.status === "FAILED") {
      // Thrown so `errorResponse` logs it; a hand-built 502 left no trace.
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "Submission failed");
    }
    return NextResponse.json({ data: { txHash: result.txHash } });
  });
}
