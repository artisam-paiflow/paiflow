import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareTriggerTx } from "@/lib/stellar/trigger";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

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
    if (d.flow.templateKind !== "SPLITTER") {
      throw new AppError("VALIDATION", "Only splitter deployments support trigger");
    }
    if (!d.contractAddress) {
      throw new AppError("VALIDATION", "Contract address not available");
    }

    const { xdr } = await prepareTriggerTx({
      contractAddress: d.contractAddress,
      amount: body.amount,
      fromAddress: body.userAddress,
    });

    await audit({
      action: "DEPLOY_TRIGGER",
      ip,
      metadata: { deploymentId: id, amount: body.amount },
    });

    return NextResponse.json({
      data: {
        xdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
