import "server-only";
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { loadPaymentAccount, MissingPaymentAccountError } from "./load-payment-account";
import { simulationFailure } from "./sim-error";

export type ContractReadContext = { requestId?: string };

/** Only allowlisted categories are observable; provider text/URLs can contain secrets. */
function rpcErrorCategory(err: unknown): string {
  const error = err as {
    code?: unknown;
    name?: unknown;
    cause?: { code?: unknown };
    status?: unknown;
    response?: { status?: unknown };
  } | null;
  const code = error?.code ?? error?.cause?.code;
  if (code === "RPC_DEADLINE") return "deadline";
  if (error?.name === "TimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT")
    return "timeout";
  if (error?.name === "AbortError") return "aborted";
  if (
    typeof code === "string" &&
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  )
    return "network";
  if (typeof error?.status === "number" || typeof error?.response?.status === "number")
    return "http";
  if (typeof code === "number") return "json_rpc";
  return "unknown";
}

function readFailure(
  operation: "getLedgerEntries" | "simulateTransaction",
  functionName: string,
  startedAt: number,
  context: ContractReadContext,
  category: string,
): AppError {
  log.error(
    {
      operation,
      functionName,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      requestId: context.requestId,
      category,
      code: "UPSTREAM_RPC",
    },
    "contract read RPC failed",
  );
  return new AppError(
    "UPSTREAM_RPC",
    "The Stellar RPC could not complete this contract read. Please try again.",
  );
}

/** Read-only simulation. The existing relayer source is preserved; never signed or submitted. */
export async function simulateContractCall(
  contractAddress: string,
  functionName: string,
  args: xdr.ScVal[] = [],
  context: ContractReadContext = {},
): Promise<unknown> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");

  // Read raw RPC entries: the SDK parsed reader normalizes malformed entries:null
  // into an empty array, which cannot establish genuine account absence.
  const accountStartedAt = Date.now();
  let sourceAccount: Account;
  try {
    sourceAccount = await loadPaymentAccount(server, source);
  } catch (error) {
    if (error instanceof MissingPaymentAccountError) {
      log.warn(
        {
          operation: "getLedgerEntries",
          functionName,
          requestId: context.requestId,
          category: "account_absent",
          elapsedMs: Math.max(0, Date.now() - accountStartedAt),
        },
        "contract read source account absent",
      );
      throw new AppError(
        "INSUFFICIENT_FUNDS",
        `Relayer account ${source} is not funded or does not exist`,
      );
    }
    throw readFailure(
      "getLedgerEntries",
      functionName,
      accountStartedAt,
      context,
      "account_unavailable",
    );
  }

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(new Contract(contractAddress).call(functionName, ...args))
    .setTimeout(30)
    .build();
  const simulationStartedAt = Date.now();
  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await server.simulateTransaction(tx);
  } catch (err) {
    throw readFailure(
      "simulateTransaction",
      functionName,
      simulationStartedAt,
      context,
      rpcErrorCategory(err),
    );
  }
  if (rpc.Api.isSimulationError(sim)) throw simulationFailure(sim.error);
  if (!sim.result?.retval) {
    throw readFailure(
      "simulateTransaction",
      functionName,
      simulationStartedAt,
      context,
      "invalid_response",
    );
  }
  return scValToNative(sim.result.retval);
}

export async function simulateGetter(
  contractAddress: string,
  functionName: string,
  context: ContractReadContext = {},
): Promise<unknown> {
  return simulateContractCall(contractAddress, functionName, [], context);
}
