import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { stellarRelayerAddress } from "@/lib/env";
import { ChargeRelayerMode } from "@prisma/client";
import { prepareSubscriptionSetRelayerInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";

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
    if (d.flow.templateKind !== "SUBSCRIPTION") {
      throw new AppError("VALIDATION", "Deployment is not a subscription");
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

    // Persist the desired configuration immediately. The on-chain relayer
    // address must match for charges to succeed; if it differs we return a
    // set_relayer XDR so the owner can update the contract in the same flow.
    await db.deployment.update({
      where: { id },
      data: {
        chargeRelayerMode: body.mode as ChargeRelayerMode,
        chargeRelayerUrl: body.mode === "USER" ? body.url : null,
        chargeRelayerToken: body.mode === "USER" ? body.token : null,
        chargeRelayerAddress: newRelayerAddress ?? null,
      },
    });

    const needsOnChainUpdate =
      body.mode !== "MANUAL" && newRelayerAddress && newRelayerAddress !== d.chargeRelayerAddress;

    let setRelayerXdr: string | undefined;
    if (needsOnChainUpdate) {
      if (!d.sourceAccount) {
        throw new AppError("VALIDATION", "Deployment source account is not available");
      }
      const { xdr } = await prepareSubscriptionSetRelayerInvocation({
        contractAddress: subscriptionNode.contractAddress,
        adminAddress: d.sourceAccount,
        newRelayerAddress,
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
