import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareSubscriptionUnsubscribeInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";

const PostSchema = z.object({
  userAddress: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({
      key: `subscription-unsubscribe:${id}:${ip}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = PostSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
    if (d.flow.templateKind !== "SUBSCRIPTION") {
      throw new AppError("VALIDATION", "Deployment is not a subscription");
    }

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const subscriptionNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION");
    if (!subscriptionNode?.contractAddress) {
      throw new AppError("VALIDATION", "Subscription contract address not available");
    }

    const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
    if (!graph.success) {
      throw new AppError("INTERNAL", "Invalid deployment graph snapshot");
    }
    const trigger = graph.data.nodes.find(isTrigger);
    if (trigger?.type !== "subscription") {
      throw new AppError("INTERNAL", "Subscription trigger not found in graph");
    }

    if (trigger.config.subscriber !== body.userAddress) {
      throw new AppError("VALIDATION", "User address does not match the subscriber");
    }

    const { xdr } = await prepareSubscriptionUnsubscribeInvocation({
      contractAddress: subscriptionNode.contractAddress,
      subscriberAddress: body.userAddress,
    });

    return NextResponse.json({
      data: { xdr, networkPassphrase: stellarPassphrase() },
    });
  });
}
