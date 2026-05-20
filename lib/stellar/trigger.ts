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
  status: "SUCCESS" | "FAILED";
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

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(send.hash);
    if (got.status === "SUCCESS") {
      return { status: "SUCCESS", txHash: send.hash };
    }
    if (got.status === "FAILED") {
      return {
        status: "FAILED",
        txHash: send.hash,
        errorMessage: "Transaction failed on the network",
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "FAILED", txHash: send.hash, errorMessage: "Timed out waiting for finality" };
}
