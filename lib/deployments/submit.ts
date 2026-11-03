import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmDeployment } from "@/lib/deployments/confirm";
import { isDeploymentReconciliationRehearsal } from "@/lib/deployments/reconciliation-rehearsal";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
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

import type { Role, Prisma } from "@prisma/client";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { env } from "@/lib/env";
import { InstanceSnapshotSchema } from "@/lib/flow-instances/schema";
import { assertTemplateArtifactAvailability } from "@/lib/stellar/template-artifacts";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { assertSignedWalletTransaction } from "@/lib/stellar/wallet-signature";
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

export async function submitOwnedDeployment(
  req: NextRequest,
  id: string,
  user: { id: string; role: Role; developerApiTokenId?: string },
  assertAdmission?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const body = SubmitSchema.parse(await req.json());

  const signer = signerFromSignedXdr(body.signedXdr, stellarPassphrase());
  if (!signer.ok) throw new AppError("VALIDATION", "Invalid signed transaction XDR");
  const txHash = signer.txHash;

  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  if (deployment.templateVersionId) {
    if (user.role === "SANDBOX")
      throw new AppError("FORBIDDEN", "Private instances are unavailable in sandbox sessions");
    if (
      deployment.network !== env().STELLAR_NETWORK ||
      !deployment.unsignedXdr ||
      !deployment.sourceAccount ||
      !deployment.preparedTxHash
    )
      throw new AppError("CONFLICT", "Instance preparation evidence is incomplete");
    try {
      const signed = TransactionBuilder.fromXDR(body.signedXdr, stellarPassphrase());
      const original = TransactionBuilder.fromXDR(deployment.unsignedXdr, stellarPassphrase());
      if (
        !(signed instanceof Transaction) ||
        !(original instanceof Transaction) ||
        signed.toEnvelope().switch().name !== "envelopeTypeTx" ||
        original.toEnvelope().switch().name !== "envelopeTypeTx" ||
        signed.source !== deployment.sourceAccount ||
        original.hash().toString("hex") !== deployment.preparedTxHash
      )
        throw new Error("Invalid instance transaction");
      assertSignedWalletTransaction(
        deployment.unsignedXdr,
        body.signedXdr,
        deployment.sourceAccount,
        stellarPassphrase(),
      );
      if (
        deployment.status === "PENDING_SIGNATURE" &&
        BigInt(original.timeBounds?.maxTime ?? "0") <= BigInt(Math.floor(Date.now() / 1000))
      )
        throw new AppError(
          "CONFLICT",
          "Prepared instance has expired; reconcile its original identity",
        );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "VALIDATION",
        "Sign the exact prepared instance transaction with its developer source account on this network",
      );
    }
  }
  if (deployment.templateVersionId && deployment.status === "PENDING_SIGNATURE")
    await withInteractiveRpcBudget(() =>
      assertTemplateArtifactAvailability(
        InstanceSnapshotSchema.parse(deployment.instanceSnapshot).artifacts,
        id,
      ),
    );

  // Idempotency: a retry with the same signed XDR returns the existing result.
  if (deployment.status === "CONFIRMED") {
    if (deployment.deployTxHash === txHash) {
      return confirmedDeploymentResponse(deployment);
    }
    throw new AppError("CONFLICT", "Deployment already confirmed with a different transaction");
  }
  if (deployment.status === "SUBMITTED" && deployment.deployTxHash === txHash) {
    return NextResponse.json({ data: { status: "SUBMITTED", txHash } });
  }
  if (deployment.status !== "PENDING_SIGNATURE") {
    throw new AppError("CONFLICT", `Deployment is ${deployment.status}, cannot submit`);
  }
  // A surface switched off after this deployment was prepared (#722):
  // nothing is on chain yet, so it is still new use and is refused.
  assertPreparedDeploymentAllowed(
    deployment.graphSnapshot,
    deployment.pipelineSnapshot,
    undefined,
    deployment.paramsSnapshot,
  );

  // Bind the submission to the prepared transaction: the signed XDR must
  // be exactly the transaction the app built for this deployment, plus
  // signatures. Signing does not change the transaction hash, so a hash
  // comparison rejects any tampered or unrelated transaction.
  if (!deployment.unsignedXdr) {
    throw new AppError("CONFLICT", "Deployment has no prepared transaction to match against");
  }
  const prepared = signerFromSignedXdr(deployment.unsignedXdr, stellarPassphrase());
  if (!prepared.ok) {
    throw new AppError("INTERNAL", "Prepared transaction is unreadable; re-prepare the deployment");
  }
  if (prepared.txHash !== txHash) {
    throw new AppError(
      "VALIDATION",
      "Signed transaction does not match the prepared deployment transaction",
    );
  }

  // The signer row joins the status flip: a database failure aborts here,
  // before the chain call, so the row cannot be lost after a success.
  const reconciliationRehearsal = isDeploymentReconciliationRehearsal(deployment, user.role);
  const signerRow = signedTransactionRow({
    signer,
    kind: "DEPLOY",
    network: deployment.network,
    userId: user.developerApiTokenId ? null : user.id,
    developerApiTokenId: user.developerApiTokenId,
    deploymentId: id,
    ip: clientIp(req),
  });
  // The status predicate claims the deployment: two requests that both read
  // PENDING_SIGNATURE above cannot both reach the chain call, and the loser
  // fails here with P2025 before anything is written or submitted.
  const signerRowCreated = await db.$transaction(async (tx) => {
    if (assertAdmission) await assertAdmission(tx);
    if (deployment.templateVersionId) {
      const owners = await tx.$queryRaw<
        { isActive: boolean; role: Role }[]
      >`SELECT "isActive", role FROM "User" WHERE id = ${user.id}::uuid FOR SHARE`;
      if (!owners[0]?.isActive || owners[0].role === "SANDBOX")
        throw new AppError("FORBIDDEN", "Private instance owner admission is closed");
    }
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
    metadata: {
      deploymentId: id,
      signerAddress: signer.signerAddress,
      ...(reconciliationRehearsal ? { reconciliationRehearsal: true } : {}),
    },
  });

  const result = reconciliationRehearsal
    ? await submitDeployTx(body.signedXdr, {
        confirmation: "reconcile",
        ...(deployment.templateVersionId ? { preserveUncertainRejection: true } : {}),
      })
    : deployment.templateVersionId
      ? await submitDeployTx(body.signedXdr, { preserveUncertainRejection: true })
      : await submitDeployTx(body.signedXdr);
  if (result.status === "SUBMITTED") {
    return NextResponse.json({ data: { status: "SUBMITTED", txHash: result.txHash } });
  }
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
    log.error(
      { code: "UPSTREAM_RPC", status: 502, deploymentId: id },
      "Deployment submission not accepted",
    );
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_RPC",
          message: SEND_NOT_ACCEPTED_MESSAGE,
          submissionStatus: "NOT_ACCEPTED",
        },
      },
      { status: 502 },
    );
  }
  if (result.status === "SUCCESS") {
    if (deployment.templateVersionId) {
      const expected = Array.isArray(deployment.pipelineSnapshot)
        ? deployment.pipelineSnapshot.map((node) =>
            node && typeof node === "object" && !Array.isArray(node) ? node.contractAddress : null,
          )
        : [];
      if (
        !expected.length ||
        !result.pipelineAddresses ||
        JSON.stringify(expected) !== JSON.stringify(result.pipelineAddresses)
      )
        throw new AppError(
          "UPSTREAM_RPC",
          "The original transaction needs address-proof reconciliation; do not prepare another instance",
        );
    }
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
}
