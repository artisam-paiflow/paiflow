import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { findPipelineNode } from "@/lib/flows/pipeline-snapshot";
import {
  setSubscriptionAmountByRelayer,
  updateScheduleByRelayer,
  updateSubscriberByRelayer,
  type DevMutateResult,
} from "@/lib/stellar/dev-mutate";

const BodySchema = z
  .object({
    nodeId: z.string().optional(),
    subscriber: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
      .optional(),
    amountPerPeriodStroops: z
      .string()
      .regex(/^\d+$/, "Amount must be a positive integer string")
      .optional(),
    schedule: z
      .object({
        startTs: z.number().int().nonnegative(),
        intervalSeconds: z.number().int().positive(),
        endTs: z.number().int().positive(),
      })
      .refine((s) => s.endTs > s.startTs, { message: "endTs must be after startTs" })
      .optional(),
  })
  .refine((b) => b.subscriber || b.amountPerPeriodStroops || b.schedule, {
    message: "Provide at least one of: subscriber, amountPerPeriodStroops, schedule",
  });

/**
 * Fill / change a deployed SUBSCRIPTION_DEV node's subscriber, per-period amount
 * and/or schedule. Each provided field is applied as a separate relayer-signed
 * transaction; all tx hashes are returned.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const rl = await rateLimit(`dev-mutate:${user.id}`, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev mutations");
    const body = BodySchema.parse(await req.json());

    const d = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");

    const node = findPipelineNode(d.pipelineSnapshot, "SUBSCRIPTION_DEV", body.nodeId);
    const addr = node.contractAddress;

    const applied: Array<{ field: string; txHash: string }> = [];
    const fail = (label: string, r: DevMutateResult) => {
      if (r.status !== "SUCCESS") {
        throw new AppError(
          "UPSTREAM_RPC",
          `${label} failed: ${r.errorMessage ?? "unknown error"} (applied so far: ${
            applied.map((a) => a.field).join(", ") || "none"
          })`,
        );
      }
      applied.push({ field: label, txHash: r.txHash });
    };

    if (body.subscriber) {
      fail("subscriber", await updateSubscriberByRelayer(addr, body.subscriber));
    }
    if (body.amountPerPeriodStroops) {
      fail("amount", await setSubscriptionAmountByRelayer(addr, body.amountPerPeriodStroops));
    }
    if (body.schedule) {
      fail("schedule", await updateScheduleByRelayer(addr, body.schedule));
    }

    await audit({
      action: "DEV_UPDATE_SUBSCRIPTION",
      userId: user.id,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, applied },
    });

    return NextResponse.json({ data: { applied, contractAddress: addr } });
  });
}
