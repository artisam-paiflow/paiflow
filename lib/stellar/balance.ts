import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress } from "./client";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type FetchTokenBalanceInput = {
  tokenAddress: string;
  holderAddress: string;
  sourceAccount?: string | null;
};

/**
 * Read a token balance from a Stellar Asset Contract for a given holder.
 * This builds a read-only invocation to the SAC `balance` method and
 * simulates it; no transaction is submitted.
 */
export async function fetchTokenBalance(input: FetchTokenBalanceInput): Promise<bigint> {
  const server = sorobanRpc();

  const source = input.sourceAccount ?? stellarRelayerAddress();
  if (!source) {
    throw new AppError("UPSTREAM_RPC", "No source account available to simulate balance query");
  }

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Failed to load source account for balance simulation: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const tokenIdBytes = decodeContractAddress(input.tokenAddress);
  const tokenScAddress = xdr.ScAddress.scAddressTypeContract(tokenIdBytes as unknown as xdr.Hash);
  const holderScVal = new Address(input.holderAddress).toScVal();

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: tokenScAddress,
      functionName: "balance",
      args: [holderScVal],
    }),
  );

  const op = Operation.invokeHostFunction({ func: hostFunction });

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError("UPSTREAM_RPC", `Balance simulation failed: ${sim.error}`);
  }
  if (!sim.result?.retval) {
    throw new AppError("UPSTREAM_RPC", "Balance simulation returned no result");
  }

  const value = scValToNative(sim.result.retval);
  if (typeof value !== "bigint") {
    throw new AppError("UPSTREAM_RPC", `Unexpected balance type: ${typeof value}`);
  }

  return value;
}
