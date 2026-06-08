import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  Transaction,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress } from "./client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type PreparedInvoke = {
  xdr: string;
};

export type PreparedInvokeTx = PreparedInvoke & {
  tx: Transaction;
};

export async function prepareDistributeInvocation(opts: {
  contractAddress: string;
  amount: string;
  invokerAddress: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.invokerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.invokerAddress).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "distribute",
      args: [fromScVal, amountScVal],
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}

export async function prepareDistributeTx(opts: {
  contractAddress: string;
  amount: string;
  sourceAccount: string;
}): Promise<PreparedInvoke> {
  return prepareDistributeInvocation({
    contractAddress: opts.contractAddress,
    amount: opts.amount,
    invokerAddress: opts.sourceAccount,
  });
}

export async function prepareWebhookExecuteInvocation(opts: {
  contractAddress: string;
  from: string;
  amount: string;
  relayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.relayerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.from).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "execute",
      args: [fromScVal, amountScVal],
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareDepositInvocation(opts: {
  contractAddress: string;
  amount: string;
  invokerAddress: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.invokerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.invokerAddress).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "deposit",
      args: [fromScVal, amountScVal],
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}
