import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { readTokenAllowance, readSubscriptionIsCancelled } from "@/lib/stellar/relayer";
import { assetContractId } from "@/lib/stellar/assets";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";

const PostSchema = z.object({
  amount: z.string().regex(/^\d+$/, "Must be a positive integer string"),
  userAddress: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
});

const MAX_I128 = 170141183460469231731687303715884105727n;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({
      key: `subscription-allowance:${id}:${ip}`,
      limit: 40,
      windowSeconds: 60,
    });

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

    const tokenContractAddress = assetContractId(trigger.config.asset);
    const [allowance, isCancelled] = await Promise.all([
      readTokenAllowance({
        tokenContractAddress,
        owner: trigger.config.subscriber,
        spender: subscriptionNode.contractAddress,
      }),
      readSubscriptionIsCancelled(subscriptionNode.contractAddress),
    ]);

    return NextResponse.json({
      data: {
        allowance: allowance.toString(),
        subscriber: trigger.config.subscriber,
        asset: trigger.config.asset,
        isCancelled,
      },
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({
      key: `subscription-allowance:${id}:${ip}`,
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

    const tokenContractAddress = assetContractId(trigger.config.asset);
    const currentAllowance = await readTokenAllowance({
      tokenContractAddress,
      owner: body.userAddress,
      spender: subscriptionNode.contractAddress,
    });

    const requested = BigInt(body.amount);
    if (currentAllowance + requested > MAX_I128) {
      throw new AppError("VALIDATION", "Cumulative allowance would exceed the maximum i128 value");
    }

    const { xdr } = await prepareTokenApproveInvocation({
      tokenContractAddress,
      from: body.userAddress,
      spender: subscriptionNode.contractAddress,
      amount: (currentAllowance + requested).toString(),
    });

    return NextResponse.json({
      data: { xdr, networkPassphrase: stellarPassphrase() },
    });
  });
}
