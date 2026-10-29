import "server-only";
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress } from "./client";
import { buildRelayerTx, relayerSourceChannel, type RelayerChannel } from "./relayer-channels";
import { stellarPassphrase, stellarRelayerAddress, stellarRelayerSecretKey } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { simulationFailure } from "./sim-error";
import { timelockSideArg } from "./scval";
import { simulateContractCall, simulateGetter } from "./contract-read";
export { simulateContractCall, simulateGetter } from "./contract-read";
/** Which list a timelock_branch release intends to pay; absent for the old timelock. */
export type ReleaseSide = "before" | "after";
function relayerReleaseKeypair(): Keypair {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  return Keypair.fromSecret(secret);
}
async function loadRelayerAccount(server: rpc.Server, relayerAddress: string) {
  try {
    return await server.getAccount(relayerAddress);
  } catch {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${relayerAddress} is not funded or does not exist`,
    );
  }
}
function releaseOperation(contractAddress: string, side?: ReleaseSide) {
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "release_by_relayer",
      args: side ? [timelockSideArg(side)] : [],
    }),
  );
  return Operation.invokeHostFunction({ func: hostFunction });
}
function buildReleaseTx(
  source: Awaited<ReturnType<rpc.Server["getAccount"]>>,
  contractAddress: string,
  side?: ReleaseSide,
) {
  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(releaseOperation(contractAddress, side))
    .setTimeout(180)
    .build();
}
export type ReleaseSimulation =
  | {
      ok: true;
      latestLedger: number;
      sim: rpc.Api.SimulateTransactionSuccessResponse;
    }
  | {
      ok: false;
      latestLedger: number;
      error: string;
    };
/**
 * Simulate a timelock's `release_by_relayer()` (with the intended `side` for a
 * timelock_branch, which reverts with ConditionNotMet if the ledger time is on
 * the other side) without signing anything, so the caller learns whether a
 * release would go through before it takes the relayer lock. A contract revert is returned, not thrown; an RPC that cannot be
 * reached still throws.
 */
export async function simulateReleaseByRelayer(
  contractAddress: string,
  side?: ReleaseSide,
): Promise<ReleaseSimulation> {
  const server = sorobanRpc();
  const source = await loadRelayerAccount(server, relayerReleaseKeypair().publicKey());
  const sim = await server.simulateTransaction(buildReleaseTx(source, contractAddress, side));
  if (rpc.Api.isSimulationError(sim)) {
    return { ok: false, latestLedger: sim.latestLedger, error: sim.error };
  }
  // Automatic restoration is carried in transactionData. Legacy restore
  // preambles are handled under the relayer channel lock before rebuilding
  // and simulating the release again, including its deadline/side checks.
  return { ok: true, latestLedger: sim.latestLedger, sim };
}
/**
 * Sign and submit a release that `simulateReleaseByRelayer()` already
 * simulated, then wait for finality. Call it inside `withRelayerChannel()` and
 * pass the channel it hands you.
 *
 * The transaction is rebuilt here on a freshly loaded source account, so its
 * sequence number is read under the lock rather than carried over from the
 * simulation, which may be minutes old by the time the lock is free. On the
 * relayer-source lane what the simulation contributes — footprint, resource
 * fee, and the source-account auth entry `release_by_relayer` needs — does not
 * depend on the sequence number, which is what makes it safe to assemble onto
 * the rebuilt envelope. On a channel that source-account entry would authorize
 * the channel, not the relayer, so the probe's simulation is discarded and the
 * call is simulated again with the relayer's address-credential entry signed.
 */
export async function sendReleaseByRelayer(
  contractAddress: string,
  sim: rpc.Api.SimulateTransactionSuccessResponse,
  side?: ReleaseSide,
  channel: RelayerChannel = relayerSourceChannel(),
): Promise<{
  status: "SUCCESS" | "FAILED";
  txHash: string;
  ledger?: number;
  errorMessage?: string;
}> {
  const server = sorobanRpc();
  const assembled = await buildRelayerTx({
    channel,
    operation: releaseOperation(contractAddress, side),
    presimulated: sim,
    onSimulationError: (message) =>
      new AppError("UPSTREAM_RPC", `release_by_relayer simulation failed: ${message}`),
  });
  const send = await server.sendTransaction(assembled);
  if (send.status === "ERROR") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    };
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(send.hash);
    if (got.status === "SUCCESS") {
      return { status: "SUCCESS", txHash: send.hash, ledger: got.ledger };
    }
    if (got.status === "FAILED") {
      return {
        status: "FAILED",
        txHash: send.hash,
        ledger: got.ledger,
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
export async function readStreamerAvailable(contractAddress: string): Promise<bigint> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "available",
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `Streamer available() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Streamer available() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== "bigint") {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected streamer available() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value;
}
export async function readStreamerPaused(contractAddress: string): Promise<boolean> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "is_paused",
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `Streamer is_paused() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Streamer is_paused() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== "boolean") {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected streamer is_paused() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value;
}
export async function readStreamerRetrieveAllowed(contractAddress: string): Promise<boolean> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "retrieve_allowed",
      args: [],
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
    // Old streamer WASM does not expose retrieve_allowed; treat as disabled.
    return false;
  }
  if (!sim.result?.retval) {
    return false;
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== "boolean") {
    return false;
  }
  return value;
}
/**
 * Build and sign a no-argument `*_by_relayer` call on `channel`. The caller
 * runs this and the matching submit inside one `withRelayerChannel()`.
 */
async function prepareByRelayer(
  contractAddress: string,
  functionName: string,
  contractKey: "streamer" | "subscription" | "payroll",
  channel: RelayerChannel,
): Promise<{
  xdr: string;
  txHash: string;
}> {
  const scAddress = xdr.ScAddress.scAddressTypeContract(
    decodeContractAddress(contractAddress) as unknown as xdr.Hash,
  );
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: scAddress, functionName, args: [] }),
  );
  const signed = await buildRelayerTx({
    channel,
    operation: Operation.invokeHostFunction({ func: hostFunction }),
    onSimulationError: (message) =>
      simulationFailure(`Soroban simulate failed for ${contractAddress}: ${message}`, {
        contract: contractKey,
      }),
  });
  return { xdr: signed.toXDR(), txHash: signed.hash().toString("hex") };
}
export async function prepareStreamerClaimByRelayerTx(
  contractAddress: string,
  channel: RelayerChannel = relayerSourceChannel(),
): Promise<{
  xdr: string;
  txHash: string;
}> {
  return prepareByRelayer(contractAddress, "claim", "streamer", channel);
}
export async function submitStreamerClaimByRelayerTx(xdr: string): Promise<{
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
  const deadline = Date.now() + 30000;
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
export async function readTokenAllowance(opts: {
  tokenContractAddress: string;
  owner: string;
  spender: string;
  classifyRpcFailures?: boolean;
}): Promise<bigint> {
  if (opts.classifyRpcFailures) {
    const value = await simulateContractCall(opts.tokenContractAddress, "allowance", [
      new Address(opts.owner).toScVal(),
      new Address(opts.spender).toScVal(),
    ]);
    if (typeof value !== "bigint")
      throw new AppError("UPSTREAM_RPC", "Unexpected subscription token allowance");
    return value;
  }
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const tokenIdBytes = decodeContractAddress(opts.tokenContractAddress);
  const tokenScAddress = xdr.ScAddress.scAddressTypeContract(tokenIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: tokenScAddress,
      functionName: "allowance",
      args: [new Address(opts.owner).toScVal(), new Address(opts.spender).toScVal()],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `Token allowance() simulation failed for ${opts.tokenContractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Token allowance() simulation returned no result for ${opts.tokenContractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== "bigint") {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected token allowance() type for ${opts.tokenContractAddress}: ${typeof value}`,
    );
  }
  return value;
}
export async function prepareSubscriptionChargeByRelayerTx(
  contractAddress: string,
  channel: RelayerChannel = relayerSourceChannel(),
): Promise<{
  xdr: string;
  txHash: string;
}> {
  return prepareByRelayer(contractAddress, "charge_by_relayer", "subscription", channel);
}
export async function submitSubscriptionChargeByRelayerTx(xdr: string): Promise<{
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
  const deadline = Date.now() + 30000;
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
async function readSubscriptionValue<T>(
  contractAddress: string,
  functionName: string,
  expectedType: string,
): Promise<T> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName,
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== expectedType) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected ${functionName}() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value as T;
}
type SubscriptionReadOptions = {
  classifyRpcFailures?: boolean;
};
export async function readSubscriptionIsCancelled(
  contractAddress: string,
  opts: SubscriptionReadOptions = {},
): Promise<boolean> {
  if (opts.classifyRpcFailures) {
    const value = await simulateGetter(contractAddress, "is_cancelled");
    if (typeof value !== "boolean")
      throw new AppError("UPSTREAM_RPC", "Unexpected subscription cancellation state");
    return value;
  }
  return readSubscriptionValue<boolean>(contractAddress, "is_cancelled", "boolean");
}
export async function readSubscriptionNextChargeAt(contractAddress: string): Promise<bigint> {
  return readSubscriptionValue<bigint>(contractAddress, "next_charge_at", "bigint");
}
export async function readSubscriptionIntervalSeconds(contractAddress: string): Promise<bigint> {
  return readSubscriptionValue<bigint>(contractAddress, "interval_seconds", "bigint");
}
export async function readSubscriptionAmountPerPeriod(contractAddress: string): Promise<bigint> {
  return readSubscriptionValue<bigint>(contractAddress, "amount_per_period", "bigint");
}
export async function readSubscriptionRelayer(contractAddress: string): Promise<string> {
  return readSubscriptionAddress(contractAddress, "relayer");
}
export async function readSubscriptionSubscriber(contractAddress: string): Promise<string> {
  return readSubscriptionAddress(contractAddress, "subscriber");
}
export async function readSubscriptionSubscriberNullable(
  contractAddress: string,
  opts: SubscriptionReadOptions = {},
): Promise<string | null> {
  if (opts.classifyRpcFailures) {
    const value = await simulateGetter(contractAddress, "subscriber");
    if (value !== null && typeof value !== "string")
      throw new AppError("UPSTREAM_RPC", "Unexpected subscription subscriber");
    return value;
  }
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "subscriber",
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `subscriber() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `subscriber() simulation returned no result for ${contractAddress}`,
    );
  }
  const retval = sim.result.retval;
  if (retval.switch().value === xdr.ScValType.scvVoid().value) {
    return null;
  }
  const value = scValToNative(retval);
  if (typeof value === "string") return value;
  try {
    return (
      value as {
        toString(): string;
      }
    ).toString();
  } catch {
    throw new AppError("UPSTREAM_RPC", `Unexpected subscriber() type for ${contractAddress}`);
  }
}
export async function readSubscriptionAsset(
  contractAddress: string,
  opts: SubscriptionReadOptions = {},
): Promise<string> {
  if (opts.classifyRpcFailures) {
    const value = await simulateGetter(contractAddress, "asset");
    if (typeof value !== "string")
      throw new AppError("UPSTREAM_RPC", "Unexpected subscription asset");
    return value;
  }
  return readSubscriptionAddress(contractAddress, "asset");
}
async function readSubscriptionAddress(
  contractAddress: string,
  functionName: string,
): Promise<string> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName,
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value === "string") return value;
  try {
    return (
      value as {
        toString(): string;
      }
    ).toString();
  } catch {
    throw new AppError("UPSTREAM_RPC", `Unexpected ${functionName}() type for ${contractAddress}`);
  }
}
async function readPayrollValue<T>(
  contractAddress: string,
  functionName: string,
  expectedType: string,
): Promise<T> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName,
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value !== expectedType) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected ${functionName}() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value as T;
}
async function readPayrollAddress(contractAddress: string, functionName: string): Promise<string> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName,
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (typeof value === "string") return value;
  try {
    return (
      value as {
        toString(): string;
      }
    ).toString();
  } catch {
    throw new AppError("UPSTREAM_RPC", `Unexpected ${functionName}() type for ${contractAddress}`);
  }
}
export async function readPayrollIsCancelled(contractAddress: string): Promise<boolean> {
  return readPayrollValue<boolean>(contractAddress, "is_cancelled", "boolean");
}
export async function readPayrollNextChargeAt(contractAddress: string): Promise<bigint> {
  return readPayrollValue<bigint>(contractAddress, "next_charge_at", "bigint");
}
export async function readPayrollIntervalSeconds(contractAddress: string): Promise<bigint> {
  return readPayrollValue<bigint>(contractAddress, "interval_seconds", "bigint");
}
export async function readPayrollRelayer(contractAddress: string): Promise<string> {
  return readPayrollAddress(contractAddress, "relayer");
}
export async function readPayrollEmployer(contractAddress: string): Promise<string> {
  return readPayrollAddress(contractAddress, "employer");
}
export async function readPayrollAsset(contractAddress: string): Promise<string> {
  return readPayrollAddress(contractAddress, "asset");
}
export type PayrollRecipient = {
  address: string;
  amount: string;
};
export async function readPayrollRecipients(contractAddress: string): Promise<PayrollRecipient[]> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "recipients",
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `recipients() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `recipients() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (!Array.isArray(value)) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected recipients() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value.map((r: unknown) => {
    const item = r as {
      address:
        | string
        | {
            toString(): string;
          };
      amount:
        | bigint
        | string
        | {
            toString(): string;
          };
    };
    const address = typeof item.address === "string" ? item.address : item.address.toString();
    const amount =
      typeof item.amount === "string"
        ? item.amount
        : (
            item.amount as {
              toString(): string;
            }
          ).toString();
    return { address, amount };
  });
}
export type SplitterRecipient = {
  address: string;
  bps: number;
  amount: string;
};
export async function readSplitterRecipients(
  contractAddress: string,
): Promise<SplitterRecipient[]> {
  const server = sorobanRpc();
  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch (err) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${source} is not funded or does not exist`,
    );
  }
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "recipients",
      args: [],
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
    throw new AppError(
      "UPSTREAM_RPC",
      `recipients() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `recipients() simulation returned no result for ${contractAddress}`,
    );
  }
  const value = scValToNative(sim.result.retval);
  if (!Array.isArray(value)) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Unexpected recipients() type for ${contractAddress}: ${typeof value}`,
    );
  }
  return value.map((r: unknown) => {
    const item = r as {
      address:
        | string
        | {
            toString(): string;
          };
      bps:
        | number
        | bigint
        | {
            toString(): string;
          };
      amount:
        | bigint
        | string
        | {
            toString(): string;
          };
    };
    const address = typeof item.address === "string" ? item.address : item.address.toString();
    const bpsRaw =
      typeof item.bps === "number"
        ? item.bps
        : Number(typeof item.bps === "string" ? item.bps : item.bps.toString());
    const amount =
      typeof item.amount === "string"
        ? item.amount
        : (
            item.amount as {
              toString(): string;
            }
          ).toString();
    return { address, bps: bpsRaw, amount };
  });
}

export async function readPayerRecipients(contractAddress: string): Promise<SplitterRecipient[]> {
  const [recipient, amount, bps] = await Promise.all([
    simulateGetter(contractAddress, "recipient"),
    simulateGetter(contractAddress, "configured_amount"),
    simulateGetter(contractAddress, "percentage_bps"),
  ]);
  if (!recipient) return [];
  return [
    {
      address: String(recipient),
      amount: String(amount),
      bps: Number(bps),
    },
  ];
}
export async function preparePayrollChargeByRelayerTx(
  contractAddress: string,
  channel: RelayerChannel = relayerSourceChannel(),
): Promise<{
  xdr: string;
  txHash: string;
}> {
  return prepareByRelayer(contractAddress, "charge_by_relayer", "payroll", channel);
}
export async function submitPayrollChargeByRelayerTx(xdr: string): Promise<{
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
  const deadline = Date.now() + 30000;
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
