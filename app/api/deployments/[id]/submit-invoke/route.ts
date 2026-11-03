import { NextRequest, NextResponse } from "next/server";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { requireSession } from "@/lib/auth";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { admitLegacySubmission } from "@/lib/stellar/legacy-submission";
import { LegacySubmitSchema } from "@/lib/legacy-submission/schema";
import type { SubmitTriggerResult } from "@/lib/stellar/trigger";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit, needsSubmitRow } from "@/lib/audit";
import { hasExecutionPolicies } from "@/lib/api/v1/execution-schema";

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const sessionUser = await requireSession();
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `submit-invoke:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = LegacySubmitSchema.parse(await req.json());

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

    const { tx, signer, replay, receipt } = await admitLegacySubmission({
      deployment: d,
      kind: "INVOKE",
      signedXdr: body.signedXdr,
      userId: sessionUser?.id ?? null,
      ip,
    });
    const txHash = tx.hash().toString("hex");
    // Recorded authoritative finality survives provider-history retention. A known
    // original submission is recovery only; NOT_FOUND never starts another send.
    const hasStoredLedger = Number.isSafeInteger(receipt?.ledger) && (receipt?.ledger ?? 0) > 0;
    const result: SubmitTriggerResult =
      replay && hasStoredLedger && receipt?.outcome === "CONFIRMED"
        ? { status: "SUCCESS", txHash, signer }
        : replay && hasStoredLedger && receipt?.outcome === "FAILED"
          ? { status: "FAILED", txHash, signer, errorMessage: "Transaction failed on-chain" }
          : await submitTriggerTx(body.signedXdr, {
              recoverFinality: true,
              recoveryOnly: replay,
            });
    if (result.status === "PENDING") {
      // `tx-status` runs its confirmation bookkeeping off this row, one per
      // hash: a duplicate send writes it only if the earlier one left none.
      if (!replay && (await needsSubmitRow(id, result.txHash, result.duplicate))) {
        await audit({
          action: "DEPLOY_INVOKE",
          userId: d.ownerId,
          metadata: {
            deploymentId: id,
            txHash: result.txHash,
            signerAddress: signer.ok ? signer.signerAddress : null,
          },
        });
      }
      return NextResponse.json({ data: { txHash: result.txHash, status: "PENDING" } });
    }
    if (result.status === "FAILED") {
      // Thrown so `errorResponse` logs it; a hand-built 502 left no trace.
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "Submission failed");
    }
    return NextResponse.json({ data: { txHash: result.txHash } });
  });
}

export const POST = deploymentServiceRoute(
  (req, ctx) => withInteractiveRpcBudget(() => POSTHandler(req, ctx)),
  "public",
);
