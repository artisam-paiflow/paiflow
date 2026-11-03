import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareSubscriptionChargeInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { LegacyWalletPrepareSchema } from "@/lib/legacy-submission/schema";
import { registerLegacyPreparation } from "@/lib/stellar/legacy-submission";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({
      key: `subscription-charge:${id}:${ip}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = LegacyWalletPrepareSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, ownerId: user.id, status: "CONFIRMED" },
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

    if (!d.sourceAccount || d.sourceAccount !== body.userAddress) {
      throw new AppError("VALIDATION", "User address does not match the deployment owner");
    }

    const { xdr } = await prepareSubscriptionChargeInvocation({
      contractAddress: subscriptionNode.contractAddress,
      adminAddress: body.userAddress,
      classifyInsufficientAllowance: true,
    });

    await registerLegacyPreparation({
      deployment: d,
      kind: "INVOKE",
      unsignedXdr: xdr,
      sourceAddress: body.userAddress,
      contractAddress: subscriptionNode.contractAddress,
      method: "charge",
    });

    await audit({
      action: "DEPLOY_INVOKE",
      userId: user.id,
      metadata: { deploymentId: id, kind: "subscription-charge" },
    });

    return NextResponse.json({
      data: { xdr, networkPassphrase: stellarPassphrase() },
    });
  });
}

export const POST = deploymentServiceRoute(POSTHandler, "owner");
