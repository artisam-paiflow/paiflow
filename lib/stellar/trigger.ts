import "server-only";
import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase, env } from "@/lib/env";
import {
  prepareDistributeInvocation,
  prepareDepositInvocation,
  prepareWebhookExecuteInvocation,
} from "./invoke";

export async function prepareTriggerTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
  isPipeline?: boolean;
}): Promise<{ xdr: string }> {
  const result = opts.isPipeline
    ? await prepareDepositInvocation({
        contractAddress: opts.contractAddress,
        amount: opts.amount,
        invokerAddress: opts.fromAddress,
      })
    : await prepareDistributeInvocation({
        contractAddress: opts.contractAddress,
        amount: opts.amount,
        invokerAddress: opts.fromAddress,
      });
  return { xdr: result.xdr };
}

export type SubmitTriggerResult = {
  status: "SUCCESS" | "FAILED" | "PENDING";
  txHash: string;
  errorMessage?: string;
};

export async function submitTriggerTx(signedXdr: string): Promise<SubmitTriggerResult> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  const send = await server.sendTransaction(tx);

  if (send.status === "ERROR") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    };
  }

  return { status: "PENDING", txHash: send.hash };
}

export async function submitWebhookExecuteTx(opts: {
  contractAddress: string;
  from: string;
  amount: string;
}): Promise<SubmitTriggerResult> {
  const relayerSecret = env().STELLAR_RELAYER_SECRET;
  if (!relayerSecret) {
    throw new Error("STELLAR_RELAYER_SECRET is not configured");
  }

  const relayerAddress = env().STELLAR_RELAYER_ADDRESS;
  if (!relayerAddress) {
    throw new Error("STELLAR_RELAYER_ADDRESS is not configured");
  }

  const { tx } = await prepareWebhookExecuteInvocation({
    contractAddress: opts.contractAddress,
    from: opts.from,
    amount: opts.amount,
    relayerAddress,
  });

  const keypair = Keypair.fromSecret(relayerSecret);
  tx.sign(keypair);

  const server = sorobanRpc();
  const send = await server.sendTransaction(tx);

  if (send.status === "ERROR") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    };
  }

  return { status: "PENDING", txHash: send.hash };
}
