import "server-only";
import { BASE_FEE, Keypair, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress } from "./client";
import { stellarPassphrase, stellarRelayerSecretKey } from "@/lib/env";
import { AppError } from "@/lib/errors";

export async function prepareReleaseByRelayerTx(
  contractAddress: string,
): Promise<{ xdr: string; txHash: string }> {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }

  const server = sorobanRpc();
  const relayerKeypair = Keypair.fromSecret(secret);
  const relayerAddress = relayerKeypair.publicKey();

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(relayerAddress);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${relayerAddress} is not funded or does not exist`,
    );
  }

  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "release_by_relayer",
      args: [],
    }),
  );

  const op = Operation.invokeHostFunction({ func: hostFunction });

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Soroban simulate failed for ${contractAddress}: ${sim.error}`,
    );
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(relayerKeypair);

  return { xdr: assembled.toXDR(), txHash: assembled.hash().toString("hex") };
}

export async function submitReleaseByRelayerTx(xdr: string): Promise<{
  status: "SUCCESS" | "FAILED";
  txHash: string;
  errorMessage?: string;
}> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(xdr, stellarPassphrase());
  const send = await server.sendTransaction(tx);

  if (send.status === "ERROR") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    };
  }

  const deadline = Date.now() + 30_000;
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

  return {
    status: "FAILED",
    txHash: send.hash,
    errorMessage: "Timed out waiting for finality",
  };
}
