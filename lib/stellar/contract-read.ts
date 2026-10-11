import "server-only";
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
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

  // SDK getAccount/getAccountEntry erase transport failures as "Account not found".
  // Only a successful, empty ledger response establishes that an account is absent.
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(source).xdrPublicKey(),
    }),
  );
  const accountStartedAt = Date.now();
  let response: rpc.Api.GetLedgerEntriesResponse;
  try {
    response = await server.getLedgerEntries(key);
  } catch (err) {
    throw readFailure(
      "getLedgerEntries",
      functionName,
      accountStartedAt,
      context,
      rpcErrorCategory(err),
    );
  }
  if (!response || !Number.isInteger(response.latestLedger) || !Array.isArray(response.entries)) {
    throw readFailure(
      "getLedgerEntries",
      functionName,
      accountStartedAt,
      context,
      "invalid_response",
    );
  }
  if (response.entries.length === 0) {
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
  let sourceAccount: Account;
  try {
    const entry = response.entries[0]!;
    if (response.entries.length !== 1 || !entry.key.toXDR().equals(key.toXDR()))
      throw new Error("Unexpected account entry");
    const account = entry.val.account();
    if (!account.accountId().toXDR().equals(Keypair.fromPublicKey(source).xdrPublicKey().toXDR()))
      throw new Error("Unexpected account ID");
    sourceAccount = new Account(source, account.seqNum().toString());
  } catch {
    throw readFailure(
      "getLedgerEntries",
      functionName,
      accountStartedAt,
      context,
      "invalid_response",
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
