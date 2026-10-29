import "server-only";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ChargeRelayerMode } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { redis, eventChannel } from "@/lib/redis";
import { stellarRelayerAddress } from "@/lib/env";
import { scheduleNextStreamerClaimJob } from "@/lib/streamer-jobs";
import { log } from "@/lib/log";
import { captureServer } from "@/lib/analytics/server";
import type { StreamerParams } from "@/lib/flows/to-params";

type DeployWithFlow = Prisma.DeploymentGetPayload<{
  include: {
    flow: {
      select: {
        templateKind: true;
      };
    };
  };
}>;
export async function confirmDeployment(
  deployment: DeployWithFlow,
  result: {
    txHash: string;
    contractAddress?: string;
  },
  signerAddress: string,
  recover = false,
) {
  const id = deployment.id;
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
    nodes: Array<{
      type: string;
      config?: Record<string, unknown>;
    }>;
  } | null;
  const hasWeb2Webhook = graph?.nodes.some((n) => n.type === "web2_webhook") ?? false;
  const webhookSecret = hasWeb2Webhook ? `whsec_${crypto.randomBytes(32).toString("hex")}` : null;
  const isSubscription = deployment.flow?.templateKind === "SUBSCRIPTION";
  const schedule: {
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
    const scheduleKinds = ["SUBSCRIPTION"];
    const scheduleNode = paramsPipeline?.find((n) => scheduleKinds.includes(n.templateKind));
    const relayer =
      typeof scheduleNode?.params?.relayer === "string" ? scheduleNode.params.relayer : null;
    const startTs =
      typeof scheduleNode?.params?.startTs === "number"
        ? scheduleNode.params.startTs
        : Math.floor(Date.now() / 1000);
    const platformRelayer = stellarRelayerAddress();
    schedule.chargeRelayerMode =
      platformRelayer && relayer === platformRelayer
        ? ChargeRelayerMode.PLATFORM
        : ChargeRelayerMode.MANUAL;
    schedule.chargeRelayerAddress = relayer;
    schedule.nextChargeAt = new Date(Math.max(startTs, Math.floor(Date.now() / 1000)) * 1000);
    schedule.chargeEndAt =
      typeof scheduleNode?.params?.endTs === "number"
        ? new Date(scheduleNode.params.endTs * 1000)
        : null;
  }
  // Try to win the race and confirm this deployment. If another request
  // already confirmed it (e.g. a retry), we return the existing result.
  let updatedDeployment: Awaited<ReturnType<typeof db.deployment.update>> | null;
  try {
    updatedDeployment = await db.deployment.update({
      where: recover
        ? { id, status: { in: ["SUBMITTED", "FAILED"] }, deployTxHash: result.txHash }
        : { id, status: "SUBMITTED" },
      data: {
        status: "CONFIRMED",
        deployTxHash: result.txHash,
        contractAddress,
        confirmedAt: new Date(),
        ...(webhookSecret ? { webhookSecret } : {}),
        ...schedule,
      },
    });
  } catch (err) {
    const code = (
      err as {
        code?: string;
      }
    ).code;
    // P2002: another request committed the same unique txHash.
    // P2025: the extended where filter no longer matches because another
    // request already flipped the status to CONFIRMED (race-loser path).
    if (code === "P2002" || code === "P2025") {
      updatedDeployment = await db.deployment.findUnique({
        where: { id },
      });
      if (
        updatedDeployment?.status === "CONFIRMED" &&
        updatedDeployment.deployTxHash === result.txHash
      ) {
        return updatedDeployment;
      }
      throw new AppError("CONFLICT", "Transaction already used for another deployment");
    }
    throw err;
  }
  if (!updatedDeployment) {
    updatedDeployment = await db.deployment.findUnique({
      where: { id },
    });
    if (
      updatedDeployment?.status === "CONFIRMED" &&
      updatedDeployment.deployTxHash === result.txHash
    ) {
      return updatedDeployment;
    }
    throw new AppError("CONFLICT", "Deployment state changed during submission");
  }
  // Schedule the first auto-claim job for each STREAMER node so the
  // per-streamer cron can claim vested funds at the right milestones
  // instead of scanning every contract every 5 minutes.
  const paramsSnapshot = deployment.paramsSnapshot as Array<{
    nodeId: string;
    templateKind: string;
    params:
      | {
          kind: string;
        }
      | StreamerParams;
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
    userId: deployment.ownerId,
    metadata: { deploymentId: id, txHash: result.txHash },
  });
  captureDeployConfirmed(deployment.ownerId, deployment, pipeline, result.txHash, signerAddress);
  return updatedDeployment;
}
// Runs after the chain has confirmed, so nothing in here may throw into the
// response: a confirmed deploy answering 500 would invite a resubmit.
function captureDeployConfirmed(
  userId: string,
  deployment: {
    id: string;
    flowId: string;
    createdAt: Date;
  },
  pipeline: Array<{
    templateKind: string;
  }> | null,
  txHash: string,
  signerAddress: string,
) {
  try {
    const templateKinds = (pipeline ?? []).map((n) => n.templateKind);
    // A legacy deployment has no snapshot, only the one scalar contractAddress.
    const contractCount = pipeline ? pipeline.length : 1;
    void captureServer(userId, "deploy_confirmed", {
      deployment_id: deployment.id,
      flow_id: deployment.flowId,
      tx_hash: txHash,
      signer_address: signerAddress,
      template_kinds: templateKinds,
      has_swap: templateKinds.includes("SWAPPER"),
      contract_count: contractCount,
      created_to_confirmed_ms: Date.now() - deployment.createdAt.getTime(),
    });
  } catch (err) {
    log.warn({ err, deploymentId: deployment.id }, "submit: analytics capture failed");
  }
}
