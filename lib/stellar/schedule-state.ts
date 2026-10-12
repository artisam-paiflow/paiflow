import "server-only";
import {
  Account,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "./client";
import { readStreamerConfig } from "./streamer-config";
import { fetchTokenBalance } from "./balance";

/** No cached display data is used to authorize controls. Each getter is simulated, never sent. */
export async function readScheduleState(contractAddress: string, sourceAccount: string | null) {
  try {
    const config = await readStreamerConfig(contractAddress);
    const readSource =
      sourceAccount ?? (StrKey.isValidEd25519PublicKey(config.admin) ? config.admin : null);
    if (!readSource) throw new Error();
    const server = sorobanRpc();
    const source = await server.getAccount(readSource);
    const read = async (method: string): Promise<unknown> => {
      const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
        fee: BASE_FEE,
        networkPassphrase: stellarPassphrase(),
      })
        .addOperation(new Contract(contractAddress).call(method))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) throw new Error();
      return scValToNative(sim.result.retval);
    };
    // Bounded groups avoid a large concurrent RPC burst.
    const [paused, pauseAllowed, retrieveAllowed] = await Promise.all([
      read("is_paused"),
      read("pause_allowed"),
      read("retrieve_allowed"),
    ]);
    const [available, claimed] = await Promise.all([read("available"), read("claimed")]);
    const balance = await fetchTokenBalance({
      tokenAddress: config.asset,
      holderAddress: contractAddress,
      sourceAccount: readSource,
    });
    const validAmount = (value: unknown): value is bigint =>
      typeof value === "bigint" && value >= 0n && value <= (1n << 127n) - 1n;
    if (
      typeof paused !== "boolean" ||
      typeof pauseAllowed !== "boolean" ||
      typeof retrieveAllowed !== "boolean" ||
      !validAmount(available) ||
      !validAmount(claimed) ||
      !validAmount(balance)
    )
      throw new Error();
    const unvested = balance > available ? balance - available : 0n;
    return {
      controller: config.admin,
      tokenContractAddress: config.asset,
      paused,
      pauseAllowed,
      retrieveAllowed,
      availableStroops: available.toString(),
      claimedStroops: claimed.toString(),
      balanceStroops: balance.toString(),
      unvestedStroops: unvested.toString(),
      controlEligibility: {
        walletProtocolSupported: StrKey.isValidEd25519PublicKey(config.admin),
        pause: StrKey.isValidEd25519PublicKey(config.admin) && pauseAllowed && !paused,
        resume: StrKey.isValidEd25519PublicKey(config.admin) && pauseAllowed && paused,
        retrieve:
          StrKey.isValidEd25519PublicKey(config.admin) &&
          paused &&
          retrieveAllowed &&
          unvested > 0n,
      },
      retrievalRecipient: config.admin,
      retrievableStroops: paused && retrieveAllowed ? unvested.toString() : "0",
      readAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UPSTREAM_RPC", "Current Schedule state could not be read");
  }
}
