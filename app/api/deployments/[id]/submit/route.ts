import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { redis, eventChannel } from "@/lib/redis";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
import { ChargeRelayerMode, EmployeePayoutMode } from "@prisma/client";
import { scheduleNextStreamerClaimJob } from "@/lib/streamer-jobs";
import { log } from "@/lib/log";
import type { StreamerParams } from "@/lib/flows/to-params";
import { isPendingAddress, SenderKycSchema } from "@/lib/flows/schema";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

function txHashFromXdr(signedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  return tx.hash().toString("hex");
}

function confirmedDeploymentResponse(deployment: {
  status: string;
  deployTxHash: string | null;
  contractAddress: string | null;
  pipelineSnapshot: unknown;
}) {
  const pipeline = deployment.pipelineSnapshot as Array<{
    nodeId: string;
    contractAddress: string;
    templateKind: string;
  }> | null;
  return NextResponse.json({
    data: {
      status: deployment.status,
      txHash: deployment.deployTxHash,
      contractAddress: deployment.contractAddress,
      pipeline: pipeline ?? undefined,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = SubmitSchema.parse(await req.json());

    let txHash: string;
    try {
      txHash = txHashFromXdr(body.signedXdr);
    } catch {
      throw new AppError("VALIDATION", "Invalid signed transaction XDR");
    }

    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

    // Idempotency: a retry with the same signed XDR returns the existing result.
    if (deployment.status === "CONFIRMED") {
      if (deployment.deployTxHash === txHash) {
        return confirmedDeploymentResponse(deployment);
      }
      throw new AppError("CONFLICT", "Deployment already confirmed with a different transaction");
    }
    if (deployment.status !== "PENDING_SIGNATURE") {
      throw new AppError("CONFLICT", `Deployment is ${deployment.status}, cannot submit`);
    }

    // Bind the submission to the prepared transaction: the signed XDR must
    // be exactly the transaction the app built for this deployment, plus
    // signatures. Signing does not change the transaction hash, so a hash
    // comparison rejects any tampered or unrelated transaction.
    if (!deployment.unsignedXdr) {
      throw new AppError("CONFLICT", "Deployment has no prepared transaction to match against");
    }
    let expectedTxHash: string;
    try {
      expectedTxHash = txHashFromXdr(deployment.unsignedXdr);
    } catch {
      throw new AppError(
        "INTERNAL",
        "Prepared transaction is unreadable; re-prepare the deployment",
      );
    }
    if (expectedTxHash !== txHash) {
      throw new AppError(
        "VALIDATION",
        "Signed transaction does not match the prepared deployment transaction",
      );
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
        // The schedule node carries the relayer / start / end the auto-charge
        // cron needs. A subscription deploys as SUBSCRIPTION or (dev mode)
        // SUBSCRIPTION_DEV; a payroll deploys as PAYROLL (monolith), as
        // SUBSCRIPTION_DEV (dev), or as SUBSCRIPTION (immutable non-dev).
        const scheduleKinds = isSubscription
          ? ["SUBSCRIPTION", "SUBSCRIPTION_DEV"]
          : ["PAYROLL", "SUBSCRIPTION_DEV", "SUBSCRIPTION"];
        const scheduleNode = paramsPipeline?.find((n) => scheduleKinds.includes(n.templateKind));
        const streamerNode = paramsPipeline?.find((n) => n.templateKind === "STREAMER");
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
          typeof streamerNode?.params?.endTs === "number"
            ? new Date(streamerNode.params.endTs * 1000)
            : null;
      }

      // Try to win the race and confirm this deployment. If another request
      // already confirmed it (e.g. a retry), we return the existing result.
      let updatedDeployment: Awaited<ReturnType<typeof db.deployment.update>> | null;
      try {
        updatedDeployment = await db.deployment.update({
          where: { id, status: "SUBMITTED" },
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
        const code = (err as { code?: string }).code;
        // P2002: another request committed the same unique txHash.
        // P2025: the extended where filter no longer matches because another
        // request already flipped the status to CONFIRMED (race-loser path).
        if (code === "P2002" || code === "P2025") {
          updatedDeployment = await db.deployment.findUnique({
            where: { id },
          });
          if (updatedDeployment?.deployTxHash === result.txHash) {
            return confirmedDeploymentResponse(updatedDeployment);
          }
          throw new AppError("CONFLICT", "Transaction already used for another deployment");
        }
        throw err;
      }

      if (!updatedDeployment) {
        updatedDeployment = await db.deployment.findUnique({
          where: { id },
        });
        if (updatedDeployment?.deployTxHash === result.txHash) {
          return confirmedDeploymentResponse(updatedDeployment);
        }
        throw new AppError("CONFLICT", "Deployment state changed during submission");
      }

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

      // Immutable non-dev payrolls bake recipients into the SPLITTER at deploy
      // time, so we must create Employee rows now so later charges can generate
      // off-ramp jobs for fiat employees.
      if (isPayroll) {
        await createPayrollEmployees(id);
      }

      // If the designer captured sender KYC at build time, persist it as this
      // deployment's OffRampSenderProfile now so the first off-ramp payout can
      // run without waiting for the post-deploy form. Upsert keeps duplicate
      // submits idempotent, and the post-deploy form can still overwrite it.
      await createOffRampSenderProfile(id);

      return confirmedDeploymentResponse(updatedDeployment);
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

const OFFRAMP_SENDER_KINDS = new Set(["PAYROLL", "CASH_OUT", "CASH_OUT_DEV"]);

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

    const pipeline = (deployment.pipelineSnapshot ?? []) as Array<{ templateKind: string }>;
    if (!pipeline.some((n) => OFFRAMP_SENDER_KINDS.has(n.templateKind))) return;

    const senderKyc = (deployment.graphSnapshot as { senderKyc?: unknown } | null)?.senderKyc;
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

  // Only the new immutable non-dev decomposition needs Employee rows created
  // here. Legacy PAYROLL employees are created via payroll-update-recipients,
  // and dev-mode payroll employees are created/updated via the same API.
  const hasPayroll = pipeline.some((n) => n.templateKind === "PAYROLL");
  const hasDev = pipeline.some(
    (n) => n.templateKind === "SUBSCRIPTION_DEV" || n.templateKind === "SPLITTER_DEV",
  );
  const hasSubscription = pipeline.some((n) => n.templateKind === "SUBSCRIPTION");
  const hasSplitter = pipeline.some((n) => n.templateKind === "SPLITTER");
  const hasPayer = pipeline.some((n) => n.templateKind === "PAYER");
  if (hasPayroll || hasDev || !hasSubscription || (!hasSplitter && !hasPayer)) return;

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
      if ((err as { code?: string }).code === "P2002") {
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
    if ((err as { code?: string }).code === "P2002") {
      // Distinguish a duplicate-submit race from a real uniqueness bug. If
      // employees already exist, another request won the race and we are done.
      const count = await db.employee.count({ where: { deploymentId } });
      if (count > 0) return;
    }
    throw err;
  }
}
