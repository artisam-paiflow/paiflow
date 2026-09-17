import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareTriggerTx, prepareWebhookDepositTx } from "@/lib/stellar/trigger";
import { prepareStreamerTopUpInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { FlowGraphSchema, assetLabel, migrateFlowGraph } from "@/lib/flows/schema";
import { inboundRequirement } from "@/lib/flows/inbound-amount";
import { formatStroops } from "@/lib/utils";
import { log } from "@/lib/log";

const PostSchema = z.object({
  amount: z.string().regex(/^\d+$/, "Must be a positive integer"),
  userAddress: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `trigger:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = PostSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

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

    return NextResponse.json({
      data: {
        xdr,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}

/**
 * Refuse an amount the pipeline will not consume as configured.
 *
 * Only reaches the payer/splitter path — a webhook deposit and a streamer
 * top-up fund a contract rather than run a payout, so their amounts are the
 * sender's to choose.
 */
function assertAmountMatchesFlow(
  deploymentId: string,
  graphSnapshot: unknown,
  amountStroops: string,
): void {
  const parsed = FlowGraphSchema.safeParse(migrateFlowGraph(graphSnapshot));
  if (!parsed.success) {
    // Rows saved before a schema change still have to be triggerable, so this
    // fails open — logged rather than silent, because it is a hole in the guard.
    log.warn({ deploymentId }, "trigger amount guard skipped: graph snapshot did not parse");
    return;
  }

  const requirement = inboundRequirement(parsed.data);
  if (requirement.kind === "variable") return;

  const label = assetLabel(requirement.asset);
  const required = BigInt(requirement.stroops);
  const sent = BigInt(amountStroops);

  if (requirement.kind === "exact" && sent !== required) {
    throw new AppError(
      "VALIDATION",
      `This flow pays out exactly ${formatStroops(required)} ${label}. You entered ${formatStroops(sent)} ${label} — send ${formatStroops(required)} ${label} instead.`,
      { amount: [`Must be ${formatStroops(required)} ${label}`] },
    );
  }

  if (requirement.kind === "minimum" && sent < required) {
    throw new AppError(
      "VALIDATION",
      `This flow pays out ${formatStroops(required)} ${label}. You entered ${formatStroops(sent)} ${label}, which is not enough to cover it.`,
      { amount: [`Must be at least ${formatStroops(required)} ${label}`] },
    );
  }
}
