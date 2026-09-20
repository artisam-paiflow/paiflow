import "server-only";
import { type SorobanErrorHint } from "./soroban-errors";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { sorobanRpc, withRelayerLock } from "./client";
import { signerFromTransaction, type SignerInfo } from "./signer";
import { classifySend, SEND_NOT_ACCEPTED_MESSAGE } from "./send-status";
import { stellarPassphrase, stellarRelayerSecretKey, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  prepareDistributeInvocation,
  prepareDepositInvocation,
  prepareWebhookExecuteInvocation,
  prepareWebhookDepositInvocation,
  prepareWebhookEscrowInvocation,
} from "./invoke";

export async function prepareTriggerTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
  isPipeline?: boolean;
  hint?: SorobanErrorHint | (() => Promise<SorobanErrorHint>);
}): Promise<{ xdr: string }> {
  const result = opts.isPipeline
    ? await prepareDepositInvocation({
        contractAddress: opts.contractAddress,
        amount: opts.amount,
        invokerAddress: opts.fromAddress,
        hint: opts.hint,
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

export async function submitTriggerTx(signedXdr: string): Promise<SubmitTriggerResult> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  const signer = signerFromTransaction(tx);
  const send = await server.sendTransaction(tx);
  const sent = classifySend(send);

  // Thrown, not returned as FAILED: nothing was sent, so there is no hash for
  // the caller to poll or record, only a request to make again.
  if (sent.outcome === "NOT_ACCEPTED") {
    throw new AppError("UPSTREAM_RPC", SEND_NOT_ACCEPTED_MESSAGE);
  }
  if (sent.outcome === "REJECTED") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
      signer,
    };
  }

  return { status: "PENDING", txHash: send.hash, signer, duplicate: sent.duplicate };
}

export async function submitWebhookExecuteTx(opts: {
  contractAddress: string;
  from?: string;
  amount?: string;
  auth?: string[];
  escrow?: boolean;
}): Promise<SubmitTriggerResult> {
  return withRelayerLock(async () => {
    const relayerSecret = stellarRelayerSecretKey();
    if (!relayerSecret) {
      throw new Error("STELLAR_RELAYER_SECRET_KEY is not configured");
    }

    const relayerAddress = stellarRelayerAddress();
    if (!relayerAddress) {
      throw new Error("STELLAR_RELAYER_ADDRESS is not configured");
    }

    if (!opts.escrow && !opts.amount) {
      throw new Error("Amount is required for non-escrow triggers");
    }

    const maxRetries = 3;
    let lastErrorMessage: string | undefined;
    let lastTxHash = "";

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { tx } = opts.escrow
        ? await prepareWebhookEscrowInvocation({
            contractAddress: opts.contractAddress,
            amount: opts.amount,
            relayerAddress,
          })
        : await prepareWebhookExecuteInvocation({
            contractAddress: opts.contractAddress,
            from: opts.from!,
            amount: opts.amount!,
            relayerAddress,
            auth: opts.auth,
          });

      const keypair = Keypair.fromSecret(relayerSecret);
      tx.sign(keypair);

      const server = sorobanRpc();
      const send = await server.sendTransaction(tx);
      const sent = classifySend(send);

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
