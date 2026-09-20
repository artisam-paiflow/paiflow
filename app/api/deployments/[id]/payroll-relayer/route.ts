import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AppError, withErrorHandler } from "@/lib/errors";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
import { assertPublicUrl } from "@/lib/net/assert-public-url";
import { MAX_URL_LENGTH } from "@/lib/net/public-url";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ChargeRelayerMode } from "@prisma/client";
import {
  preparePayrollSetRelayerInvocation,
  prepareSubscriptionSetRelayerInvocation,
} from "@/lib/stellar/invoke";
import { readPayrollRelayer, readSubscriptionRelayer } from "@/lib/stellar/relayer";

type PipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

const PAYROLL_KINDS = new Set(["PAYROLL", "SUBSCRIPTION_DEV", "SUBSCRIPTION"]);

function findPayrollNode(pipeline: PipelineNode[] | null): PipelineNode | null {
  return pipeline?.find((n) => PAYROLL_KINDS.has(n.templateKind)) ?? null;
}

const PostSchema = z.object({
  mode: z.enum(["PLATFORM", "USER", "MANUAL"]),
  url: z.string().url().max(MAX_URL_LENGTH).optional(),
  token: z.string().max(2048).optional(),
  relayerAddress: z
    .string()
    .refine((s) => !s || StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
    .optional(),
});

function serializeDate(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.flow.templateKind !== "PAYROLL") {
      throw new AppError("VALIDATION", "Deployment is not a payroll");
    }

    return NextResponse.json({
      data: {
        mode: d.chargeRelayerMode,
        relayerAddress: d.chargeRelayerAddress,
        url: d.chargeRelayerUrl,
        nextChargeAt: serializeDate(d.nextChargeAt),
        lastChargedAt: serializeDate(d.lastChargedAt),
        chargeEndAt: serializeDate(d.chargeEndAt),
        platformRelayerAddress: stellarRelayerAddress(),
      },
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    // The URL check below resolves a caller-supplied hostname, so an unthrottled
    // POST here is a DNS oracle as well as a write endpoint (§10, #371).
    await enforceRateLimit({
      key: `relayer-config:${user.id}`,
      limit: 20,
      windowSeconds: 60,
      message: "Too many relayer configuration updates",
    });
    const body = PostSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.flow.templateKind !== "PAYROLL") {
      throw new AppError("VALIDATION", "Deployment is not a payroll");
    }

    const pipeline = d.pipelineSnapshot as PipelineNode[] | null;
    const payrollNode = findPayrollNode(pipeline);
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }
    const isDev = payrollNode.templateKind === "SUBSCRIPTION_DEV";

    const platformRelayer = stellarRelayerAddress();

    if (body.mode === "PLATFORM") {
      if (!platformRelayer) {
        throw new AppError("VALIDATION", "Platform relayer is not configured in this environment");
      }
      body.relayerAddress = platformRelayer;
    }

    let relayerHost: string | null = null;
    if (body.mode === "USER") {
      if (!body.url) throw new AppError("VALIDATION", "User relayer URL is required");
      if (!body.relayerAddress) {
        throw new AppError("VALIDATION", "User relayer address is required");
      }
      // Nothing has been written yet, so a refusal leaves the row untouched.
      const safeUrl = await assertPublicUrl(body.url, { subject: "Relayer URL", field: "url" });
      body.url = safeUrl.toString();
      relayerHost = safeUrl.hostname;
    }

    const newRelayerAddress =
      body.mode === "PLATFORM"
        ? platformRelayer
        : body.mode === "USER"
          ? body.relayerAddress
          : undefined;

    await db.deployment.update({
      where: { id },
      data: {
        chargeRelayerMode: body.mode as ChargeRelayerMode,
        chargeRelayerUrl: body.mode === "USER" ? body.url : null,
        chargeRelayerToken: body.mode === "USER" ? body.token : null,
        chargeRelayerAddress: newRelayerAddress ?? null,
      },
    });

    // Host only: the token never, and not the full URL either, since a query
    // string can carry a secret.
    await audit({
      action: "DEPLOY_RELAYER_CONFIG",
      userId: user.id,
      metadata: {
        deploymentId: id,
        kind: "payroll",
        mode: body.mode,
        relayerHost,
        hasToken: Boolean(body.token),
      },
    });

    let onChainRelayer: string | null = null;
    try {
      onChainRelayer = isDev
        ? await readSubscriptionRelayer(payrollNode.contractAddress)
        : await readPayrollRelayer(payrollNode.contractAddress);
    } catch {
      onChainRelayer = d.chargeRelayerAddress;
    }

    const needsOnChainUpdate =
      body.mode !== "MANUAL" && newRelayerAddress && newRelayerAddress !== onChainRelayer;

    let setRelayerXdr: string | undefined;
    if (needsOnChainUpdate) {
      if (!d.sourceAccount) {
        throw new AppError("VALIDATION", "Deployment source account is not available");
      }
      const { xdr } = isDev
        ? await prepareSubscriptionSetRelayerInvocation({
            contractAddress: payrollNode.contractAddress,
            adminAddress: d.sourceAccount,
            newRelayerAddress: newRelayerAddress,
          })
        : await preparePayrollSetRelayerInvocation({
            contractAddress: payrollNode.contractAddress,
            adminAddress: d.sourceAccount,
            newRelayerAddress: newRelayerAddress,
          });
      setRelayerXdr = xdr;
    }

    return NextResponse.json({
      data: {
        mode: body.mode,
        relayerAddress: newRelayerAddress ?? null,
        setRelayerXdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
