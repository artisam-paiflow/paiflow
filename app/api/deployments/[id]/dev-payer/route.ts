import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findPipelineNode } from "@/lib/flows/pipeline-snapshot";
import { updatePaymentByRelayer } from "@/lib/stellar/dev-mutate";

const BodySchema = z
  .object({
    nodeId: z.string().optional(),
    recipient: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
    mode: z.enum(["fixed", "percentage"]).default("fixed"),
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string").optional(),
    percentage: z.number().min(0).max(100).optional(),
  })
  .refine(
    (b) =>
      b.mode === "percentage"
        ? b.percentage !== undefined && b.percentage > 0
        : !!b.amountStroops && b.amountStroops !== "0",
    { message: "Provide amountStroops for fixed mode or percentage for percentage mode" },
  );

/**
 * Fill / change the recipient + value of a deployed PAYER_DEV node. Relayer-signed.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const rlKey = user ? `dev-mutate:${user.id}` : `dev-mutate:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev mutations");
    const body = BodySchema.parse(await req.json());

    const d = await db.deployment.findFirst({ where: user ? { id, ownerId: user.id } : { id } });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");

    const node = findPipelineNode(d.pipelineSnapshot, "PAYER_DEV", body.nodeId);

    const percentageBps = body.mode === "percentage" ? Math.round((body.percentage ?? 0) * 100) : 0;
    const amountStroops = body.mode === "percentage" ? "0" : (body.amountStroops ?? "0");

    const result = await updatePaymentByRelayer(node.contractAddress, {
      recipient: body.recipient,
      amountStroops,
      percentageBps,
    });
    if (result.status !== "SUCCESS") {
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_payment failed");
    }

    await audit({
      action: "DEV_UPDATE_PAYMENT",
      userId: user?.id ?? null,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, txHash: result.txHash },
    });

    return NextResponse.json({
      data: { txHash: result.txHash, contractAddress: node.contractAddress },
    });
  });
}
