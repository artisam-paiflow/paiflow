import { NextRequest, NextResponse } from "next/server";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareTriggerTx, prepareWebhookDepositTx } from "@/lib/stellar/trigger";
import { prepareStreamerTopUpInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { assertAmountMatchesFlow } from "@/lib/stellar/assert-inbound-amount";
import { LegacyTriggerPrepareSchema } from "@/lib/legacy-submission/schema";
import { registerLegacyPreparation } from "@/lib/stellar/legacy-submission";
import { hasExecutionPolicies } from "@/lib/api/v1/execution-schema";

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `trigger:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = LegacyTriggerPrepareSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
    if (hasExecutionPolicies(d.graphSnapshot))
      throw new AppError(
        "VALIDATION",
        "Policy-v1 payments require the exact execution preparation flow",
      );

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

    const hint = await buildPipelineErrorHint(pipeline);

    let xdr: string;
    if (isWebhook) {
      const result = await prepareWebhookDepositTx({
        contractAddress: d.contractAddress,
        amount: body.amount,
        fromAddress: body.userAddress,
        hint,
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
      // The trigger page is public and its lock is only cosmetic without this:
      // over-funding a fixed payer strands the surplus in the contract, where
      // nothing but the admin-only `cancel()` can reach it.
      assertAmountMatchesFlow(id, d.graphSnapshot, body.amount);

      const result = await prepareTriggerTx({
        contractAddress: d.contractAddress,
        amount: body.amount,
        fromAddress: body.userAddress,
        isPipeline,
        hint,
      });
      xdr = result.xdr;
    }

    await registerLegacyPreparation({
      deployment: d,
      kind: "TRIGGER",
      unsignedXdr: xdr,
      sourceAddress: body.userAddress,
      contractAddress: d.contractAddress,
      method: isWebhook ? "deposit" : isStreamer ? "top_up" : isPipeline ? "deposit" : "distribute",
      amount: body.amount,
    });

    return NextResponse.json({
      data: {
        xdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}

export const POST = deploymentServiceRoute(
  (req, ctx) => withInteractiveRpcBudget(() => POSTHandler(req, ctx)),
  "public",
);
