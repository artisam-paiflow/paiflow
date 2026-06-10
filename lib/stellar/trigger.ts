import "server-only";
import {
  Keypair,
  TransactionBuilder,
  rpc,
  Address,
  Operation,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress, withRelayerLock } from "./client";
import { stellarPassphrase, stellarRelayerSecretKey, stellarRelayerAddress } from "@/lib/env";
import {
  prepareDistributeInvocation,
  prepareDepositInvocation,
  prepareWebhookExecuteInvocation,
  prepareWebhookEscrowInvocation,
  prepareTokenTransferInvocation,
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

export async function prepareWebhookDepositTx(opts: {
  contractAddress: string;
  amount: string;
  fromAddress: string;
}): Promise<{ xdr: string }> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.fromAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const assetHostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "asset",
      args: [],
    }),
  );

  const assetTx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(Operation.invokeHostFunction({ func: assetHostFunction }))
    .setTimeout(180)
    .build();

  const assetSim = await server.simulateTransaction(assetTx);
  if (rpc.Api.isSimulationError(assetSim)) {
    throw new Error(`Failed to query contract asset: ${assetSim.error}`);
  }

  const assetScVal = (assetSim as any).result?.retval;
  if (!assetScVal) {
    throw new Error("Contract returned no asset");
  }

  const assetAddress = Address.fromScVal(assetScVal).toString();

  const result = await prepareTokenTransferInvocation({
    tokenContractAddress: assetAddress,
    from: opts.fromAddress,
    to: opts.contractAddress,
    amount: opts.amount,
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

      if (send.status !== "ERROR") {
        return { status: "PENDING", txHash: send.hash };
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
