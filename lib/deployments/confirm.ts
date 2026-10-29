import "server-only";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ChargeRelayerMode, EmployeePayoutMode } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { redis, eventChannel } from "@/lib/redis";
import { stellarRelayerAddress } from "@/lib/env";
import { scheduleNextStreamerClaimJob } from "@/lib/streamer-jobs";
import { log } from "@/lib/log";
import { captureServer } from "@/lib/analytics/server";
import type { StreamerParams } from "@/lib/flows/to-params";
import { isPendingAddress, SenderKycSchema } from "@/lib/flows/schema";
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
  const isPayroll = deployment.flow?.templateKind === "PAYROLL";
  const schedule: {
    chargeRelayerMode?: ChargeRelayerMode;
    chargeRelayerAddress?: string | null;
    nextChargeAt?: Date | null;
    chargeEndAt?: Date | null;
  } = {};
  if (isSubscription || isPayroll) {
    const paramsPipeline = deployment.paramsSnapshot as Array<{
      nodeId: string;
      templateKind: string;
      params: Record<string, unknown>;
    }> | null;
    const scheduleKinds = isSubscription ? ["SUBSCRIPTION"] : ["PAYROLL", "SUBSCRIPTION"];
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
  if (isPayroll) {
    await createPayrollEmployees(id);
  }
  // If the designer captured sender KYC at build time, persist it as this
  // deployment's OffRampSenderProfile now so the first off-ramp payout can
  // run without waiting for the post-deploy form. Upsert keeps duplicate
  // submits idempotent, and the post-deploy form can still overwrite it.
  await createOffRampSenderProfile(id);
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
const OFFRAMP_SENDER_KINDS = new Set(["PAYROLL", "CASH_OUT"]);
// Persist the design-time sender KYC (graphSnapshot.senderKyc) as the
// deployment's OffRampSenderProfile. Wrapped in its own try/catch: a
// profile-write failure must never fail an already-confirmed deploy — the
// post-deploy form/API remains the fallback.
async function createOffRampSenderProfile(deploymentId: string) {
  try {
    const deployment = await db.deployment.findUnique({
      where: { id: deploymentId },
      select: { graphSnapshot: true, pipelineSnapshot: true },
    });
    if (!deployment) return;
    const pipeline = (deployment.pipelineSnapshot ?? []) as Array<{
      templateKind: string;
    }>;
    if (!pipeline.some((n) => OFFRAMP_SENDER_KINDS.has(n.templateKind))) return;
    const senderKyc = (
      deployment.graphSnapshot as {
        senderKyc?: unknown;
      } | null
    )?.senderKyc;
    const parsed = SenderKycSchema.safeParse(senderKyc);
    if (!parsed.success) return;
    await db.offRampSenderProfile.upsert({
      where: { deploymentId },
      create: { deploymentId, ...parsed.data },
      update: { ...parsed.data },
    });
  } catch (err) {
    log.warn(
      {
        deploymentId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to persist sender KYC profile at deploy time",
    );
  }
}
async function createPayrollEmployees(deploymentId: string) {
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!deployment || deployment.flow?.templateKind !== "PAYROLL") return;
  const pipeline = (deployment.pipelineSnapshot ?? []) as Array<{
    nodeId: string;
    contractAddress: string;
    templateKind: string;
  }>;
  const hasPayroll = pipeline.some((n) => n.templateKind === "PAYROLL");
  const hasSubscription = pipeline.some((n) => n.templateKind === "SUBSCRIPTION");
  const hasSplitter = pipeline.some((n) => n.templateKind === "SPLITTER");
  const hasPayer = pipeline.some((n) => n.templateKind === "PAYER");
  if (hasPayroll || !hasSubscription || (!hasSplitter && !hasPayer)) return;
  const graph = deployment.graphSnapshot as {
    nodes: Array<{
      id: string;
      type: string;
      config?: {
        recipient?: string;
        payoutMode?: string;
        accountName?: string;
        accountNumber?: string;
        bankCode?: string;
        amountStroops?: string;
        recipients?: Array<{
          address: string;
          mode?: string;
          amountStroops?: string;
          label?: string;
          payoutMode?: string;
          accountName?: string;
          accountNumber?: string;
          bankCode?: string;
        }>;
      };
    }>;
  } | null;
  const cashOutByNodeId = new Map<string, string>();
  for (const node of pipeline) {
    if (node.templateKind === "CASH_OUT") {
      cashOutByNodeId.set(node.nodeId, node.contractAddress);
    }
  }
  // Single-pay payroll: one employee described by the pay node itself. A fiat
  // pay node is represented on-chain by its generated cash-out contract.
  const payNode = graph?.nodes.find((n) => n.type === "pay");
  if (hasPayer && payNode?.config) {
    const c = payNode.config;
    const isFiat = c.payoutMode === "fiat";
    const cashOutAddress = isFiat ? (cashOutByNodeId.get(`${payNode.id}-cashout-0`) ?? null) : null;
    const employeeAddress = (() => {
      if (isFiat && cashOutAddress) return cashOutAddress;
      if (c.recipient && isPendingAddress(c.recipient)) return `${c.recipient}:0`;
      return c.recipient ?? `PENDING:unnamed:0`;
    })();
    try {
      await db.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            deploymentId,
            address: employeeAddress,
            amountStroops: c.amountStroops ?? "0",
            payoutMode: isFiat ? EmployeePayoutMode.FIAT : EmployeePayoutMode.CRYPTO,
            cashOutContractAddress: cashOutAddress,
          },
        });
        if (isFiat && c.accountName && c.accountNumber && c.bankCode) {
          await tx.employeeBankDetail.create({
            data: {
              employeeId: employee.id,
              accountName: c.accountName,
              accountNumber: c.accountNumber,
              bankCode: c.bankCode,
            },
          });
        }
      });
    } catch (err) {
      if (
        (
          err as {
            code?: string;
          }
        ).code === "P2002"
      ) {
        const count = await db.employee.count({ where: { deploymentId } });
        if (count > 0) return;
      }
      throw err;
    }
    return;
  }
  const splitNode = graph?.nodes.find((n) => n.type === "split");
  if (!splitNode?.config?.recipients?.length) return;
  const recipients = splitNode.config.recipients;
  // Create all employees and their bank details in one transaction. If a
  // duplicate submit request races us, the unique constraint on
  // (deploymentId, address) fires; in that case the other request already
  // created the rows and we can safely ignore the conflict.
  try {
    await db.$transaction(async (tx) => {
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        if (!r) continue;
        const isFiat = r.payoutMode === "fiat";
        const cashOutNodeId = `${splitNode.id}-cashout-${i}`;
        const cashOutAddress = isFiat ? (cashOutByNodeId.get(cashOutNodeId) ?? null) : null;
        // Fiat employees are represented on-chain by their cash-out contract
        // address, so use that as the employee address when available. Any
        // pending placeholder must be made unique per recipient to avoid
        // colliding on the (deploymentId, address) unique index.
        const employeeAddress = (() => {
          if (isFiat && cashOutAddress) return cashOutAddress;
          if (isPendingAddress(r.address)) return `${r.address}:${i}`;
          return r.address;
        })();
        const employee = await tx.employee.create({
          data: {
            deploymentId,
            address: employeeAddress,
            amountStroops: r.amountStroops ?? "0",
            label: r.label,
            payoutMode: isFiat ? EmployeePayoutMode.FIAT : EmployeePayoutMode.CRYPTO,
            cashOutContractAddress: cashOutAddress,
          },
        });
        if (isFiat && r.accountName && r.accountNumber && r.bankCode) {
          await tx.employeeBankDetail.create({
            data: {
              employeeId: employee.id,
              accountName: r.accountName,
              accountNumber: r.accountNumber,
              bankCode: r.bankCode,
            },
          });
        }
      }
    });
  } catch (err) {
    if (
      (
        err as {
          code?: string;
        }
      ).code === "P2002"
    ) {
      // Distinguish a duplicate-submit race from a real uniqueness bug. If
      // employees already exist, another request won the race and we are done.
      const count = await db.employee.count({ where: { deploymentId } });
      if (count > 0) return;
    }
    throw err;
  }
}
