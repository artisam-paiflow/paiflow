import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { redis, eventChannel } from "@/lib/redis";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { stellarRelayerAddress } from "@/lib/env";
import { ChargeRelayerMode } from "@prisma/client";
import { scheduleNextStreamerClaimJob } from "@/lib/streamer-jobs";
import { log } from "@/lib/log";
import type { StreamerParams } from "@/lib/flows/to-params";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = SubmitSchema.parse(await req.json());

    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    if (deployment.status !== "PENDING_SIGNATURE") {
      throw new AppError("CONFLICT", `Deployment is ${deployment.status}, cannot submit`);
    }

    await db.deployment.update({
      where: { id },
      data: { status: "SUBMITTED" },
    });
    await audit({ action: "DEPLOY_SUBMIT", userId: user.id, metadata: { deploymentId: id } });

    const result = await submitDeployTx(body.signedXdr);
    if (result.status === "SUCCESS") {
      // For pipeline deployments we trust the deterministic pre-computed
      // addresses stored in pipelineSnapshot.  For legacy single-contract
      // deployments we fall back to the address returned by the RPC.
      const pipeline = deployment.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;
      const contractAddress = pipeline?.[0]?.contractAddress ?? result.contractAddress ?? null;

      const graph = deployment.graphSnapshot as {
        nodes: Array<{ type: string; config?: Record<string, unknown> }>;
      } | null;
      const hasWeb2Webhook = graph?.nodes.some((n) => n.type === "web2_webhook") ?? false;
      const webhookSecret = hasWeb2Webhook
        ? `whsec_${crypto.randomBytes(32).toString("hex")}`
        : null;

      const isSubscription = deployment.flow?.templateKind === "SUBSCRIPTION";
      const subscriptionSchedule: {
        chargeRelayerMode?: ChargeRelayerMode;
        chargeRelayerAddress?: string | null;
        nextChargeAt?: Date | null;
        chargeEndAt?: Date | null;
      } = {};
      if (isSubscription) {
        const paramsPipeline = deployment.paramsSnapshot as Array<{
          nodeId: string;
          templateKind: string;
          params: Record<string, unknown>;
        }> | null;
        const subNode = paramsPipeline?.find((n) => n.templateKind === "SUBSCRIPTION");
        const streamerNode = paramsPipeline?.find((n) => n.templateKind === "STREAMER");
        const relayer =
          typeof subNode?.params?.relayer === "string" ? subNode.params.relayer : null;
        const startTs =
          typeof subNode?.params?.startTs === "number"
            ? subNode.params.startTs
            : Math.floor(Date.now() / 1000);
        const platformRelayer = stellarRelayerAddress();
        subscriptionSchedule.chargeRelayerMode =
          platformRelayer && relayer === platformRelayer
            ? ChargeRelayerMode.PLATFORM
            : ChargeRelayerMode.MANUAL;
        subscriptionSchedule.chargeRelayerAddress = relayer;
        subscriptionSchedule.nextChargeAt = new Date(
          Math.max(startTs, Math.floor(Date.now() / 1000)) * 1000,
        );
        subscriptionSchedule.chargeEndAt =
          typeof streamerNode?.params?.endTs === "number"
            ? new Date(streamerNode.params.endTs * 1000)
            : null;
      }

      await db.deployment.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          deployTxHash: result.txHash,
          contractAddress,
          confirmedAt: new Date(),
          ...(webhookSecret ? { webhookSecret } : {}),
          ...subscriptionSchedule,
        },
      });

      // Schedule the first auto-claim job for each STREAMER node so the
      // per-streamer cron can claim vested funds at the right milestones
      // instead of scanning every contract every 5 minutes.
      const paramsSnapshot = deployment.paramsSnapshot as Array<{
        nodeId: string;
        templateKind: string;
        params: { kind: string } | StreamerParams;
      }> | null;

      if (paramsSnapshot) {
        for (const node of paramsSnapshot) {
          if (node.templateKind !== "STREAMER" || node.params.kind !== "streamer") {
            continue;
          }
          const pipelineNode = pipeline?.find((p) => p.nodeId === node.nodeId);
          if (!pipelineNode?.contractAddress) continue;

          try {
            await scheduleNextStreamerClaimJob(
              db,
              id,
              node.nodeId,
              pipelineNode.contractAddress,
              node.params as StreamerParams,
            );
          } catch (scheduleErr) {
            log.warn(
              {
                deploymentId: id,
                nodeId: node.nodeId,
                contractAddress: pipelineNode.contractAddress,
                error: scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr),
              },
              "Failed to schedule initial streamer claim job",
            );
          }
        }
      }

      const redisClient = redis();
      if (redisClient) {
        redisClient
          .publish(
            eventChannel(id),
            JSON.stringify({ type: "status", status: "CONFIRMED", deploymentId: id }),
          )
          .catch(() => {
            // Fire-and-forget: the client still polls as a fallback.
          });
      }

      await audit({
        action: "DEPLOY_CONFIRM",
        userId: user.id,
        metadata: { deploymentId: id, txHash: result.txHash },
      });
      return NextResponse.json({
        data: {
          status: "CONFIRMED",
          txHash: result.txHash,
          contractAddress,
          pipeline: pipeline ?? undefined,
        },
      });
    }
    await db.deployment.update({
      where: { id },
      data: {
        status: "FAILED",
        deployTxHash: result.txHash,
        errorMessage: result.errorMessage,
      },
    });
    await audit({
      action: "DEPLOY_FAIL",
      userId: user.id,
      metadata: { deploymentId: id, error: result.errorMessage },
    });
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_RPC",
          message: result.errorMessage ?? "Deployment failed",
        },
      },
      { status: 502 },
    );
  });
}
