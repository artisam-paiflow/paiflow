import "server-only";
import { signedTokenAttribution, type ApiTokenType } from "@/lib/api/v1/auth";
import type { Deployment, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  beforeServiceSubmission,
  lockDeployment,
  withDeploymentWork,
} from "@/lib/deployments/service-work";
import { insertSignedTransaction, signedTransactionRow } from "@/lib/signed-tx";
import { beginTransactionSubmission, recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { sorobanRpc } from "@/lib/stellar/client";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import {
  readControlIntent,
  verifyControlTransaction,
  type WalletControlAction,
} from "./control-intent";
import { getTransactionStatus } from "./transaction-status";
import type { TransactionStatus } from "./schema";

/** Domain routes authenticate with v1Route and supply an eligibility check for the selected action. */
export async function submitControlIntent(input: {
  deployment: Deployment;
  /** Omitted only by an explicitly authorized public wallet route. */
  tokenId?: string;
  tokenType?: ApiTokenType;
  action: WalletControlAction;
  intent: string;
  signedXdr: string;
  ip: string;
  /** Check live controller/config/permissions. Token ownership is never wallet authorization. */
  assertEligible: () => Promise<void>;
  /** Extra visibility admission is serialized with owner opt-out before first send. */
  assertAdmission?: (client: Prisma.TransactionClient) => Promise<void>;
}): Promise<TransactionStatus> {
  if (!input.tokenId && input.action !== "payment.execute")
    throw new AppError("FORBIDDEN", "This wallet control requires an authenticated API credential");
  const intent = await readControlIntent(input.intent, input.deployment.id, input.action);
  const { tx, signer } = verifyControlTransaction(intent, input.signedXdr);
  linkApiTransaction(intent.txHash);
  if (intent.state !== "PREPARED") return getTransactionStatus(input.deployment, intent.txHash);
  // Never reject a finality retry on wall-clock expiry; only the first send is bounded here.
  if (BigInt(intent.maxTime) <= BigInt(Math.floor(Date.now() / 1000)))
    throw new AppError(
      "CONFLICT",
      "Preparation expired; reconcile its finality before preparing another",
    );
  await input.assertEligible();
  return withDeploymentWork(input.deployment.id, `wallet-control:${input.action}`, async () => {
    const claimed = await db.$transaction(async (client) => {
      const service = await lockDeployment(client, input.deployment.id);
      if (service.serviceState !== "ACTIVE")
        throw new AppError("CONFLICT", "Deployment service is closed");
      await input.assertAdmission?.(client);
      const { count } = await client.walletControlIntent.updateMany({
        where: { id: intent.id, state: "PREPARED" },
        data: { state: "SUBMITTING", submittedAt: new Date() },
      });
      if (!count) return false;
      const row = signedTransactionRow({
        signer,
        kind:
          input.action === "payment.execute"
            ? input.tokenId
              ? "API_EXECUTE"
              : "TRIGGER"
            : "INVOKE",
        network: env().STELLAR_NETWORK,
        deploymentId: input.deployment.id,
        ...(input.tokenId
          ? signedTokenAttribution({ tokenId: input.tokenId, tokenType: input.tokenType })
          : {}),
        ip: input.ip,
      });
      if (!row) throw new AppError("INTERNAL", "Cannot record wallet-control signer");
      await insertSignedTransaction(row, client);
      await client.auditLog.create({
        data: {
          action:
            input.action === "payment.execute"
              ? input.tokenId
                ? "API_EXECUTE_SUBMITTED"
                : "DEPLOY_TRIGGER"
              : "DEPLOY_INVOKE",
          userId: null,
          ip: input.ip,
          metadata: {
            deploymentId: input.deployment.id,
            txHash: intent.txHash,
            intent: intent.id,
            nodeId: intent.nodeId,
            method: input.action,
            signerAddress: intent.walletAddress,
            tokenId: input.tokenId,
            tokenType: input.tokenId ? (input.tokenType ?? "deployment_token") : "public_wallet",
          },
        },
      });
      return true;
    });
    // Across replicas only the claimant sends. A crashed claimant never enables another send.
    if (!claimed) return getTransactionStatus(input.deployment, intent.txHash);
    await beforeServiceSubmission(intent.txHash, "rpc");
    const submissionAttempt = await beginTransactionSubmission(intent.txHash);
    let send;
    try {
      send = await sorobanRpc().sendTransaction(tx);
    } catch {
      await recordTransactionOutcome(intent.txHash, "UNRESOLVED", {
        submissionAttempt,
        failureCode: "RPC_UNAVAILABLE",
      });
      return { txHash: intent.txHash, network: env().STELLAR_NETWORK, status: "UNKNOWN" };
    }
    if (send.status === "PENDING" || send.status === "DUPLICATE") {
      await recordTransactionOutcome(intent.txHash, "ACCEPTED", { submissionAttempt });
      return { txHash: intent.txHash, network: env().STELLAR_NETWORK, status: "PENDING" };
    }
    // A queue refusal is not proof of ledger failure and cannot unlock replacement preparation.
    await recordTransactionOutcome(intent.txHash, "REJECTED", {
      submissionAttempt,
      failureCode: "RPC_REJECTED",
    });
    return {
      txHash: intent.txHash,
      network: env().STELLAR_NETWORK,
      status: "REJECTED",
      error: {
        code: "RPC_REJECTED",
        message: "Submission was refused; reconcile the prepared hash before preparing again",
      },
    };
  });
}
