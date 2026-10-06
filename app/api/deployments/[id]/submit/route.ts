import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmDeployment } from "@/lib/deployments/confirm";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { assertPreparedDeploymentAllowed } from "@/lib/features";
import { audit } from "@/lib/audit";
import { submitDeployTx } from "@/lib/stellar/deploy";
import { SEND_NOT_ACCEPTED_MESSAGE } from "@/lib/stellar/send-status";
import { signerFromSignedXdr } from "@/lib/stellar/signer";
import {
  captureTransactionSigned,
  insertSignedTransaction,
  signedTransactionRow,
} from "@/lib/signed-tx";
import { clientIp } from "@/lib/rate-limit";
import { stellarPassphrase } from "@/lib/env";
import { log } from "@/lib/log";
import { captureServer } from "@/lib/analytics/server";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

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
    await enforceWriteRateLimit("deploymentSubmit", user.id);
    const { id } = await ctx.params;
    const body = SubmitSchema.parse(await req.json());

    const signer = signerFromSignedXdr(body.signedXdr, stellarPassphrase());
    if (!signer.ok) throw new AppError("VALIDATION", "Invalid signed transaction XDR");
    const txHash = signer.txHash;

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
    // A surface switched off after this deployment was prepared (#722):
    // nothing is on chain yet, so it is still new use and is refused.
    assertPreparedDeploymentAllowed(deployment.graphSnapshot, deployment.pipelineSnapshot);

    // Bind the submission to the prepared transaction: the signed XDR must
    // be exactly the transaction the app built for this deployment, plus
    // signatures. Signing does not change the transaction hash, so a hash
    // comparison rejects any tampered or unrelated transaction.
    if (!deployment.unsignedXdr) {
      throw new AppError("CONFLICT", "Deployment has no prepared transaction to match against");
    }
    const prepared = signerFromSignedXdr(deployment.unsignedXdr, stellarPassphrase());
    if (!prepared.ok) {
      throw new AppError(
        "INTERNAL",
        "Prepared transaction is unreadable; re-prepare the deployment",
      );
    }
    if (prepared.txHash !== txHash) {
      throw new AppError(
        "VALIDATION",
        "Signed transaction does not match the prepared deployment transaction",
      );
    }

    // The signer row joins the status flip: a database failure aborts here,
    // before the chain call, so the row cannot be lost after a success.
    const signerRow = signedTransactionRow({
      signer,
      kind: "DEPLOY",
      network: deployment.network,
      userId: user.id,
      deploymentId: id,
      ip: clientIp(req),
    });
    // The status predicate claims the deployment: two requests that both read
    // PENDING_SIGNATURE above cannot both reach the chain call, and the loser
    // fails here with P2025 before anything is written or submitted.
    const signerRowCreated = await db.$transaction(async (tx) => {
      try {
        await tx.deployment.update({
          where: { id, status: "PENDING_SIGNATURE" },
          data: { status: "SUBMITTED", deployTxHash: txHash },
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2025") {
          throw new AppError("CONFLICT", "Deployment state changed during submission");
        }
        throw err;
      }
      return signerRow ? insertSignedTransaction(signerRow, tx) : false;
    });
    if (signerRow && signerRowCreated) captureTransactionSigned(signerRow);
    await audit({
      action: "DEPLOY_SUBMIT",
      userId: user.id,
      metadata: { deploymentId: id, signerAddress: signer.signerAddress },
    });

    const result = await submitDeployTx(body.signedXdr);
    if (result.status === "NOT_ACCEPTED") {
      // Nothing reached the network, so nothing failed: the claim is handed
      // back and the same signed envelope can be submitted again. It still
      // matches `unsignedXdr`, its signer row is keyed on the hash and inserts
      // once, and each attempt leaves its own DEPLOY_SUBMIT row. No hash is
      // stored because none was queued, and no DEPLOY_FAIL or `deploy_failed`
      // is recorded for a deployment that can still confirm.
      try {
        await db.deployment.update({
          where: { id, status: "SUBMITTED" },
          data: { status: "PENDING_SIGNATURE", deployTxHash: null },
        });
      } catch (err) {
        if ((err as { code?: string }).code !== "P2025") throw err;
        log.warn({ deploymentId: id }, "submit: send not accepted, but no longer SUBMITTED");
      }
      throw new AppError("UPSTREAM_RPC", SEND_NOT_ACCEPTED_MESSAGE);
    }
    if (result.status === "SUCCESS") {
      const confirmed = await confirmDeployment(deployment, result, signer.signerAddress);
      await recordTransactionOutcome(result.txHash, "CONFIRMED", {
        deploymentId: id,
        ledger: result.ledger,
      });
      return confirmedDeploymentResponse(confirmed);
    }
    if (result.failureCode === "FINALITY_UNKNOWN") {
      await db.deployment.updateMany({
        where: { id, status: "SUBMITTED" },
        data: { deployTxHash: result.txHash },
      });
      return NextResponse.json({ data: { status: "SUBMITTED", txHash: result.txHash } });
    }
    // Only the row this request claimed may be failed: a deployment another
    // request has since confirmed keeps its CONFIRMED status.
    try {
      await db.deployment.update({
        where: { id, status: "SUBMITTED" },
        data: {
          status: "FAILED",
          deployTxHash: result.txHash,
          errorMessage: result.errorMessage,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2025") throw err;
      log.warn({ deploymentId: id }, "submit: failed result for a deployment no longer SUBMITTED");
    }
    if (result.failureCode === "ONCHAIN_FAILED")
      await recordTransactionOutcome(result.txHash, "FAILED", {
        ledger: result.ledger,
        deploymentId: id,
        failureCode: "ONCHAIN_FAILED",
      });
    await audit({
      action: "DEPLOY_FAIL",
      userId: user.id,
      metadata: { deploymentId: id, error: result.errorMessage },
    });
    void captureServer(user.id, "deploy_failed", {
      stage: "submit",
      error_class: "upstream_rpc",
      error_code: "UPSTREAM_RPC",
      flow_id: deployment.flowId,
      deployment_id: id,
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
