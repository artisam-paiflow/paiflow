import "server-only";
import {
  Address,
  Account,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sorobanRpc, decodeContractAddress } from "./client";

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
  // Transaction-sensitive callers always get a new, uncached read context.
  return createTokenBalanceReader(input.sourceAccount)(input);
}

/** One lazy account lookup for a batch of read-only balance simulations. */
export function createTokenBalanceReader(sourceAccount?: string | null) {
  const server = sorobanRpc();
  const source = sourceAccount ?? stellarRelayerAddress();
  let account: Promise<{ address: string; sequence: string }> | undefined;
  return async (
    input: Pick<FetchTokenBalanceInput, "tokenAddress" | "holderAddress">,
  ): Promise<bigint> => {
    account ??= (async () => {
      if (!source) {
        throw new AppError("UPSTREAM_RPC", "No source account available to simulate balance query");
      }
      try {
        const loaded = await server.getAccount(source);
        return { address: loaded.accountId(), sequence: loaded.sequenceNumber() };
      } catch (err) {
        throw new AppError(
          "UPSTREAM_RPC",
          `Failed to load source account for balance simulation: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
    const snapshot = await account;
    // TransactionBuilder increments its Account. Never share that mutable
    // object between simulations, or reuse this snapshot for signed submissions.
    const sourceAcct = new Account(snapshot.address, snapshot.sequence);

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
  };
}
