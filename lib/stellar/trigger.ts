import "server-only";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { beginTransactionSubmission, recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { type SorobanErrorHint } from "./soroban-errors";
import { sorobanRpc } from "./client";
import { buildRelayerTx, withRelayerChannel } from "./relayer-channels";
import { simulationFailure } from "./sim-error";
import { signerFromTransaction, type SignerInfo } from "./signer";
import { classifySend, SEND_NOT_ACCEPTED_MESSAGE } from "./send-status";
import {
  prepareDistributeInvocation,
  prepareDepositInvocation,
  prepareWebhookDepositInvocation,
  webhookExecuteOperation,
  webhookEscrowOperation,
} from "./invoke";

export async function prepareTriggerTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
  isPipeline?: boolean;
  timeoutSeconds?: 60 | 180;
  hint?: SorobanErrorHint | (() => Promise<SorobanErrorHint>);
}): Promise<{ xdr: string }> {
  const result = opts.isPipeline
    ? await prepareDepositInvocation({
        contractAddress: opts.contractAddress,
        amount: opts.amount,
        invokerAddress: opts.fromAddress,
        hint: opts.hint,
        timeoutSeconds: opts.timeoutSeconds,
      })
    : await prepareDistributeInvocation({
        contractAddress: opts.contractAddress,
        amount: opts.amount,
        invokerAddress: opts.fromAddress,
      });
  return { xdr: result.xdr };
}

export async function prepareWebhookDepositTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
  hint?: SorobanErrorHint;
}): Promise<{ xdr: string }> {
  const result = await prepareWebhookDepositInvocation({
    contractAddress: opts.contractAddress,
    amount: opts.amount,
    from: opts.fromAddress,
    hint: opts.hint,
  });
  return { xdr: result.xdr };
}

export type SubmitTriggerResult = {
  status: "SUCCESS" | "FAILED" | "PENDING";
  txHash: string;
  errorMessage?: string;
  /** Set for user-signed envelopes; the relayer paths sign their own. */
  signer?: SignerInfo;
  /**
   * PENDING only: the RPC already had this envelope queued, so an earlier
   * submit sent it and wrote its audit row. Callers must not write a second.
   */
  duplicate?: boolean;
};

export async function submitTriggerTx(
  signedXdr: string,
  opts: { recoverFinality?: boolean } = {},
): Promise<SubmitTriggerResult> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  const signer = signerFromTransaction(tx);
  const txHash = tx.hash().toString("hex");
  // Invoke retries carry the identical envelope. Query its hash, never a
  // caller-supplied receipt hash, before attempting another network submission.
  // Missing finality is not success and retains the normal submission path.
  const existingResult = async (): Promise<SubmitTriggerResult | undefined> => {
    const existing = await server.getTransaction(txHash).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "UPSTREAM_RPC",
        "Transaction finality could not be checked; retry with the same envelope",
      );
    });
    if (existing.status !== "SUCCESS" && existing.status !== "FAILED") return undefined;
    await recordTransactionOutcome(txHash, existing.status === "SUCCESS" ? "CONFIRMED" : "FAILED", {
      ledger: existing.ledger,
      ...(existing.status === "FAILED" ? { failureCode: "ONCHAIN_FAILED" as const } : {}),
    });
    return {
      status: existing.status,
      txHash,
      signer,
      ...(existing.status === "FAILED" ? { errorMessage: "Transaction failed on-chain" } : {}),
    };
  };
  if (opts.recoverFinality) {
    const existing = await existingResult();
    if (existing) return existing;
  }
  const submissionAttempt = await beginTransactionSubmission(txHash);
  let send;
  try {
    send = await server.sendTransaction(tx);
  } catch (error) {
    await recordTransactionOutcome(txHash, "UNRESOLVED", {
      failureCode: "RPC_UNAVAILABLE",
      submissionAttempt,
    });
    throw error;
  }
  const sent = classifySend(send);
  // Finality can arrive between the lookup and send. A replay refusal must not
  // overwrite that receipt, but a truly unknown hash still reports the refusal.
  if (opts.recoverFinality && sent.outcome !== "QUEUED") {
    const existing = await existingResult();
    if (existing) return existing;
  }

  // Thrown, not returned as FAILED: nothing was sent, so there is no hash for
  // the caller to poll or record, only a request to make again.
  if (sent.outcome === "NOT_ACCEPTED") {
    await recordTransactionOutcome(txHash, "REJECTED", {
      failureCode: "RPC_REJECTED",
      submissionAttempt,
    });
    throw new AppError("UPSTREAM_RPC", SEND_NOT_ACCEPTED_MESSAGE);
  }
  if (sent.outcome === "REJECTED") {
    await recordTransactionOutcome(txHash, "REJECTED", {
      failureCode: "RPC_REJECTED",
      submissionAttempt,
    });
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
      signer,
    };
  }

  await recordTransactionOutcome(txHash, "ACCEPTED", { submissionAttempt });
  return { status: "PENDING", txHash: send.hash, signer, duplicate: sent.duplicate };
}

/** Keyed callbacks persist the hash before the first send and never rebuild on retry. */
export type WebhookSubmissionHooks = {
  beforeSend: (txHash: string) => Promise<void>;
  afterSend: (queued: boolean) => Promise<void>;
};

export async function submitWebhookExecuteTx(opts: {
  contractAddress: string;
  from?: string;
  amount?: string;
  auth?: string[];
  escrow?: boolean;
  submissionHooks?: WebhookSubmissionHooks;
}): Promise<SubmitTriggerResult> {
  return withRelayerChannel(async (channel) => {
    if (!opts.escrow && !opts.amount) {
      throw new Error("Amount is required for non-escrow triggers");
    }

    const maxRetries = opts.submissionHooks ? 1 : 3;
    let lastErrorMessage: string | undefined;
    let lastTxHash = "";

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const operation = opts.escrow
        ? webhookEscrowOperation({ contractAddress: opts.contractAddress, amount: opts.amount })
        : webhookExecuteOperation({
            contractAddress: opts.contractAddress,
            from: opts.from!,
            amount: opts.amount!,
            auth: opts.auth,
          });
      const tx = await buildRelayerTx({
        channel,
        operation,
        onSimulationError: (message) => simulationFailure(message, { contract: "webhook" }),
      });

      const server = sorobanRpc();
      const txHash = tx.hash().toString("hex");
      // This must finish durably before any bytes reach sendTransaction.
      await opts.submissionHooks?.beforeSend(txHash);
      let send;
      try {
        send = await server.sendTransaction(tx);
      } catch (err) {
        // A transport failure may have queued the original transaction.
        if (opts.submissionHooks) channel.trackPending(txHash, tx.timeBounds?.maxTime);
        throw err;
      }
      const sent = classifySend(send);
      if (sent.outcome === "QUEUED") channel.trackPending(txHash, tx.timeBounds?.maxTime);
      await opts.submissionHooks?.afterSend(sent.outcome === "QUEUED");

      // The webhook caller holds no envelope, only its own request, and the
      // next attempt rebuilds the transaction. Not retried in here: the network
      // says this while another relayer transaction is still pending, and
      // waiting that out would hold the relayer lock against every other signer.
      if (sent.outcome === "NOT_ACCEPTED") {
        throw new AppError(
          "UPSTREAM_RPC",
          "The network is busy and did not accept the transaction; send the request again",
        );
      }
      if (sent.outcome === "QUEUED") {
        // The caller does not wait for finality; the next holder of this
        // channel does, so its sequence number is current when it builds.
        // Already tracked before persisting the acceptance acknowledgement.
        return { status: "PENDING", txHash: send.hash, duplicate: sent.duplicate };
      }

      const errorResult = send.errorResult?.result?.();
      lastErrorMessage = `sendTransaction error: ${JSON.stringify(errorResult) ?? send.status}`;
      lastTxHash = send.hash;

      const isBadSeq = JSON.stringify(errorResult).includes("txBadSeq");
      if (!isBadSeq) {
        return {
          status: "FAILED",
          txHash: send.hash,
          errorMessage: lastErrorMessage,
        };
      }

      // Wait briefly before retry so the network state settles
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }

    return {
      status: "FAILED",
      txHash: lastTxHash,
      errorMessage: lastErrorMessage ?? "Submission failed after retries",
    };
  });
}
