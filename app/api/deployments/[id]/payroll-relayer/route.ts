import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
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

const PAYROLL_KINDS = new Set(["PAYROLL", "SUBSCRIPTION_DEV"]);

function findPayrollNode(pipeline: PipelineNode[] | null): PipelineNode | null {
  return pipeline?.find((n) => PAYROLL_KINDS.has(n.templateKind)) ?? null;
}

const PostSchema = z.object({
  mode: z.enum(["PLATFORM", "USER", "MANUAL"]),
  url: z.string().url().optional(),
  token: z.string().optional(),
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

    if (body.mode === "USER") {
      if (!body.url) throw new AppError("VALIDATION", "User relayer URL is required");
      if (!body.relayerAddress) {
        throw new AppError("VALIDATION", "User relayer address is required");
      }
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
