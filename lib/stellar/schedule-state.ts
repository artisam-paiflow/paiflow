import "server-only";
import {
  Account,
  Address,
  xdr,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { sorobanRpc } from "./client";
import { readStreamerConfig } from "./streamer-config";
import { loadPaymentAccount } from "./load-payment-account";
import { withInteractiveRpcBudget } from "./interactive-rpc-budget";
import { scheduleReadFailure, scheduleRpcRead } from "./schedule-rpc";

/** No cached display data is used to authorize controls. Each getter is simulated, never sent. */
export async function readScheduleState(contractAddress: string, sourceAccount: string | null) {
  return withInteractiveRpcBudget(async () => {
    const config = await readStreamerConfig(contractAddress);
    const readSource =
      sourceAccount ?? (StrKey.isValidEd25519PublicKey(config.admin) ? config.admin : null);
    if (!readSource) throw scheduleReadFailure("state.source", "missing_source");
    const server = sorobanRpc();
    const source = await scheduleRpcRead("state.account", () =>
      loadPaymentAccount(server, readSource),
    );
    const read = async (
      method: string,
      target = contractAddress,
      args: xdr.ScVal[] = [],
    ): Promise<unknown> => {
      const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
        fee: BASE_FEE,
        networkPassphrase: stellarPassphrase(),
      })
        .addOperation(new Contract(target).call(method, ...args))
        .setTimeout(30)
        .build();
      const sim = await scheduleRpcRead(`state.${method}`, () => server.simulateTransaction(tx));
      if (rpc.Api.isSimulationError(sim) || !sim.result?.retval)
        throw scheduleReadFailure(`state.${method}`, "invalid_simulation");
      try {
        return scValToNative(sim.result.retval);
      } catch {
        throw scheduleReadFailure(`state.${method}`, "invalid_value");
      }
    };
    // Bounded groups avoid a large concurrent RPC burst.
    const [paused, pauseAllowed, retrieveAllowed] = await Promise.all([
      read("is_paused"),
      read("pause_allowed"),
      read("retrieve_allowed"),
    ]);
    const [available, claimed] = await Promise.all([read("available"), read("claimed")]);
    const balance = await read("balance", config.asset, [new Address(contractAddress).toScVal()]);
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
      throw scheduleReadFailure("state.values", "invalid_value");
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
  });
}
