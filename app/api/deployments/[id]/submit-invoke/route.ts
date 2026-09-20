import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { stellarPassphrase } from "@/lib/env";
import { submitTriggerTx } from "@/lib/stellar/trigger";
import { signerFromSignedXdr } from "@/lib/stellar/signer";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { audit, needsSubmitRow } from "@/lib/audit";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `submit-invoke:${id}:${ip}`, limit: 20, windowSeconds: 60 });
    const body = SubmitSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

    // Recorded before the chain call, under the signer's own session if any;
    // `d.ownerId` is the owner, not necessarily the signer, and is never
    // substituted for them.
    const signer = signerFromSignedXdr(body.signedXdr, stellarPassphrase());
    const sessionUser = await getSessionUser();
    await recordSignedTransaction({
      signer,
      kind: "INVOKE",
      network: d.network,
      userId: sessionUser?.id ?? null,
      deploymentId: id,
      ip,
    });

    const result = await submitTriggerTx(body.signedXdr);
    if (result.status === "PENDING") {
      // `tx-status` runs its confirmation bookkeeping off this row, one per
      // hash: a duplicate send writes it only if the earlier one left none.
      if (await needsSubmitRow(id, result.txHash, result.duplicate)) {
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
