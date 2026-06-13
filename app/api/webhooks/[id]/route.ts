import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { submitWebhookExecuteTx } from "@/lib/stellar/trigger";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

const PostSchema = z
  .object({
    escrow: z.boolean().optional().default(false),
    from: z.string().optional(),
    amount: z.string().regex(/^\d+$/, "Must be a positive integer").optional(),
    auth: z.array(z.string()).optional(),
  })
  .refine(
    (data) => {
      if (!data.escrow) {
        return data.from ? StrKey.isValidEd25519PublicKey(data.from) : false;
      }
      return true;
    },
    { message: "Invalid or missing Stellar address", path: ["from"] },
  )
  .refine(
    (data) => {
      if (data.escrow) {
        return true; // amount optional for escrow
      }
      return !!data.amount;
    },
    { message: "Amount is required for non-escrow triggers", path: ["amount"] },
  );

function timingSafeEqual(a: string, b: string): boolean {
  const MAX = 128;
  const bufA = Buffer.alloc(MAX, 0);
  const bufB = Buffer.alloc(MAX, 0);
  bufA.write(a, 0, "utf8");
  bufB.write(b, 0, "utf8");
  return cryptoTimingSafeEqual(bufA, bufB) && a.length === b.length;
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
      auth: body.auth,
      escrow: body.escrow,
    });

    if (result.status === "PENDING") {
      await audit({
        action: "DEPLOY_TRIGGER",
        userId: deployment.flow.ownerId,
        metadata: {
          deploymentId: id,
          txHash: result.txHash,
          from: body.from,
          amount: body.amount,
          escrow: body.escrow,
        },
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
