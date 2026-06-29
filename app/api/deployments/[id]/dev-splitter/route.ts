import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findPipelineNode } from "@/lib/flows/pipeline-snapshot";
import { updateRecipientsByRelayer, type DevRecipient } from "@/lib/stellar/dev-mutate";

const RecipientSchema = z
  .object({
    address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
    mode: z.enum(["percentage", "fixed"]),
    bps: z.number().int().min(1).max(10_000).optional(),
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string").optional(),
  })
  .refine((r) => (r.mode === "percentage" ? r.bps !== undefined : !!r.amountStroops), {
    message: "percentage recipients need bps; fixed recipients need amountStroops",
  });

const BodySchema = z.object({
  nodeId: z.string().optional(),
  recipients: z.array(RecipientSchema).min(1).max(20),
});

/**
 * Fill / change the recipients of a deployed SPLITTER_DEV node. Relayer-signed.
 * The contract enforces the same invariants as the immutable splitter (no mixed
 * mode; percentage bps must sum to 10000).
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

    const node = findPipelineNode(d.pipelineSnapshot, "SPLITTER_DEV", body.nodeId);

    const recipients: DevRecipient[] = body.recipients.map((r) => ({
      address: r.address,
      bps: r.mode === "percentage" ? (r.bps ?? 0) : 0,
      amount: r.mode === "fixed" ? (r.amountStroops ?? "0") : "0",
      isCashOut: false,
    }));

    const result = await updateRecipientsByRelayer(node.contractAddress, recipients);
    if (result.status !== "SUCCESS") {
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_recipients failed");
    }

    await audit({
      action: "DEV_UPDATE_RECIPIENTS",
      userId: user?.id ?? null,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, txHash: result.txHash },
    });

    return NextResponse.json({
      data: { txHash: result.txHash, contractAddress: node.contractAddress },
    });
  });
}
