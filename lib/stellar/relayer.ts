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
    throw new AppError(
      "UPSTREAM_RPC",
      `Soroban simulate failed for ${contractAddress}: ${sim.error}`,
    );
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
    throw new AppError(
      "UPSTREAM_RPC",
      `Soroban simulate failed for ${contractAddress}: ${sim.error}`,
    );
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
