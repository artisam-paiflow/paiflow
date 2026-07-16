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
import { stellarPassphrase, stellarRelayerAddress, stellarRelayerSecretKey } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { simulationFailure } from "./sim-error";

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
    throw simulationFailure(`Soroban simulate failed for ${contractAddress}: ${sim.error}`);
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

export async function prepareStreamerClaimByRelayerTx(
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
      functionName: "claim",
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
    throw simulationFailure(`Soroban simulate failed for ${contractAddress}: ${sim.error}`, {
      contract: "streamer",
    });
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(relayerKeypair);

  return { xdr: assembled.toXDR(), txHash: assembled.hash().toString("hex") };
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

export async function readTokenAllowance(opts: {
  tokenContractAddress: string;
  owner: string;
  spender: string;
}): Promise<bigint> {
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
      functionName: "charge_by_relayer",
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
    throw simulationFailure(`Soroban simulate failed for ${contractAddress}: ${sim.error}`, {
      contract: "subscription",
    });
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(relayerKeypair);

  return { xdr: assembled.toXDR(), txHash: assembled.hash().toString("hex") };
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

export async function readSubscriptionIsCancelled(contractAddress: string): Promise<boolean> {
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
): Promise<string | null> {
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
    return (value as { toString(): string }).toString();
  } catch {
    throw new AppError("UPSTREAM_RPC", `Unexpected subscriber() type for ${contractAddress}`);
  }
}

export async function readSubscriptionAsset(contractAddress: string): Promise<string> {
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
    return (value as { toString(): string }).toString();
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
    return (value as { toString(): string }).toString();
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
      address: string | { toString(): string };
      amount: bigint | string | { toString(): string };
    };
    const address = typeof item.address === "string" ? item.address : item.address.toString();
    const amount =
      typeof item.amount === "string"
        ? item.amount
        : (item.amount as { toString(): string }).toString();
    return { address, amount };
  });
}

export type SplitterDevRecipient = {
  address: string;
  bps: number;
  amount: string;
};

export async function readSplitterDevRecipients(
  contractAddress: string,
): Promise<SplitterDevRecipient[]> {
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
      address: string | { toString(): string };
      bps: number | bigint | { toString(): string };
      amount: bigint | string | { toString(): string };
    };
    const address = typeof item.address === "string" ? item.address : item.address.toString();
    const bpsRaw =
      typeof item.bps === "number"
        ? item.bps
        : Number(typeof item.bps === "string" ? item.bps : item.bps.toString());
    const amount =
      typeof item.amount === "string"
        ? item.amount
        : (item.amount as { toString(): string }).toString();
    return { address, bps: bpsRaw, amount };
  });
}

export async function readSplitterRecipients(
  contractAddress: string,
): Promise<SplitterDevRecipient[]> {
  // The immutable splitter exposes the same recipients() shape as the dev
  // splitter: { address, bps, amount }[].
  return readSplitterDevRecipients(contractAddress);
}

/** Simulate a no-arg getter on a contract and return its native value. */
async function simulateGetter(contractAddress: string, functionName: string): Promise<unknown> {
  const server = sorobanRpc();

  const source = stellarRelayerAddress();
  if (!source) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  }

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch {
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

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(Operation.invokeHostFunction({ func: hostFunction }))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}`,
    );
  }
  return scValToNative(sim.result.retval);
}

/**
 * Read a PAYER / PAYER_DEV contract as a single-row recipient list so the
 * payroll charge + record paths can treat it like a splitter. Percentage-mode
 * payers report their bps; fixed-mode payers report their configured amount.
 */
export async function readPayerRecipients(
  contractAddress: string,
): Promise<SplitterDevRecipient[]> {
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
      functionName: "charge_by_relayer",
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
    throw simulationFailure(`Soroban simulate failed for ${contractAddress}: ${sim.error}`, {
      contract: "payroll",
    });
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(relayerKeypair);

  return { xdr: assembled.toXDR(), txHash: assembled.hash().toString("hex") };
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
