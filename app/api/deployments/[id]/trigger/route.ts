import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareTriggerTx, prepareWebhookDepositTx } from "@/lib/stellar/trigger";
import { prepareStreamerTopUpInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

const PostSchema = z.object({
  amount: z.string().regex(/^\d+$/, "Must be a positive integer"),
  userAddress: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `trigger:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = PostSchema.parse(await req.json());

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
        "Only splitter, webhook, or streamer deployments support trigger",
      );
    }
    if (!d.contractAddress) {
      throw new AppError("VALIDATION", "Contract address not available");
    }

    let xdr: string;
    if (isWebhook) {
      const result = await prepareWebhookDepositTx({
        contractAddress: d.contractAddress,
        amount: body.amount,
        fromAddress: body.userAddress,
      });
      xdr = result.xdr;
    } else if (isStreamer) {
      const result = await prepareStreamerTopUpInvocation({
        contractAddress: d.contractAddress,
        amount: body.amount,
        invokerAddress: body.userAddress,
      });
      xdr = result.xdr;
    } else {
      const result = await prepareTriggerTx({
        contractAddress: d.contractAddress,
        amount: body.amount,
        fromAddress: body.userAddress,
        isPipeline,
      });
      xdr = result.xdr;
    }

    return NextResponse.json({
      data: {
        xdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
