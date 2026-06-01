import "server-only";
import { TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase } from "@/lib/env";
import { prepareDistributeInvocation } from "./invoke";

export async function prepareTriggerTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
}): Promise<{ xdr: string }> {
  const result = await prepareDistributeInvocation({
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
