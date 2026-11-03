import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  prepareStreamerPauseInvocation,
  prepareStreamerRetrieveUnvestedInvocation,
  prepareStreamerUnpauseInvocation,
} from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { LegacyInvokePrepareSchema } from "@/lib/legacy-submission/schema";
import { registerLegacyPreparation } from "@/lib/stellar/legacy-submission";

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    await requireSession();
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `invoke:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = LegacyInvokePrepareSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

    const flowGraph = FlowGraphSchema.safeParse(d.graphSnapshot);
    if (!flowGraph.success)
      throw new AppError("VALIDATION", "Deployment graph cannot authorize this control");
    const trigger = flowGraph.data.nodes.find(isTrigger);

    if (body.method === "pause" || body.method === "unpause") {
      const pauseAllowed =
        trigger?.type === "on_schedule" ? (trigger.config.pauseAllowed ?? true) : true;
      if (!pauseAllowed) {
        throw new AppError("VALIDATION", "Pause is not allowed for this streamer deployment");
      }
    }

    if (body.method === "retrieve_unvested") {
      const retrieveAllowed =
        trigger?.type === "on_schedule" ? (trigger.config.retrieveAllowed ?? false) : false;
      if (!retrieveAllowed) {
        throw new AppError(
          "VALIDATION",
          "Retrieve unvested is not allowed for this streamer deployment",
        );
      }
    }

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;

    const streamerNode = pipeline?.find((n) => n.templateKind === "STREAMER");
    if (!streamerNode) {
      throw new AppError("VALIDATION", "Only streamer deployments support pause/resume/retrieve");
    }
    if (streamerNode.contractAddress !== body.contractAddress) {
      throw new AppError("VALIDATION", "Contract address does not match deployment pipeline");
    }

    let xdr: string;
    if (body.method === "pause") {
      ({ xdr } = await prepareStreamerPauseInvocation({
        contractAddress: body.contractAddress,
        invokerAddress: body.userAddress,
      }));
    } else if (body.method === "unpause") {
      ({ xdr } = await prepareStreamerUnpauseInvocation({
        contractAddress: body.contractAddress,
        invokerAddress: body.userAddress,
      }));
    } else {
      ({ xdr } = await prepareStreamerRetrieveUnvestedInvocation({
        contractAddress: body.contractAddress,
        invokerAddress: body.userAddress,
      }));
    }

    await registerLegacyPreparation({
      deployment: d,
      kind: "INVOKE",
      unsignedXdr: xdr,
      sourceAddress: body.userAddress,
      contractAddress: streamerNode.contractAddress,
      method: body.method,
    });

    return NextResponse.json({
      data: {
        xdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}

export const POST = deploymentServiceRoute(POSTHandler, "public");
