import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { submitWebhookExecuteTx } from "@/lib/stellar/trigger";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

const PostSchema = z.object({
  from: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
  amount: z.string().regex(/^\d+$/, "Must be a positive integer"),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `webhook:${id}:${ip}`, limit: 20, windowSeconds: 60 });

    const secretHeader = req.headers.get("x-webhook-secret") ?? "";
    const body = PostSchema.parse(await req.json());

    const deployment = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { ownerId: true } } },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

    if (!deployment.webhookSecret) {
      throw new AppError("VALIDATION", "Webhook not enabled for this deployment");
    }

    if (!timingSafeEqual(secretHeader, deployment.webhookSecret)) {
      throw new AppError("FORBIDDEN", "Invalid webhook secret");
    }

    const pipeline = deployment.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const triggerNode = pipeline?.[0];
    if (!triggerNode || triggerNode.templateKind !== "WEBHOOK") {
      throw new AppError("VALIDATION", "This deployment is not a webhook pipeline");
    }

    const result = await submitWebhookExecuteTx({
      contractAddress: triggerNode.contractAddress,
      from: body.from,
      amount: body.amount,
    });

    if (result.status === "PENDING") {
      await audit({
        action: "DEPLOY_TRIGGER",
        userId: deployment.flow.ownerId,
        metadata: { deploymentId: id, txHash: result.txHash, from: body.from, amount: body.amount },
      });
      return NextResponse.json({
        data: { txHash: result.txHash, status: "PENDING" },
      });
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
