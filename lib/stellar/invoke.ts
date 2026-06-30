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
  auth?: string[];
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

  const sorobanAuth =
    opts.auth?.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")) ?? [];

  const op = Operation.invokeHostFunction({ func: hostFunction, auth: sorobanAuth });

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

export async function prepareWebhookDepositInvocation(opts: {
  contractAddress: string;
  from: string;
  amount: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.from);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.from).toScVal();
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

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareWebhookEscrowInvocation(opts: {
  contractAddress: string;
  amount?: string;
  relayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.relayerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  // Pass 0 to the contract to signal "send entire balance"
  const amount = opts.amount ?? "0";
  const amountScVal = nativeToScVal(BigInt(amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "execute_escrow",
      args: [amountScVal],
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

export async function prepareTokenTransferInvocation(opts: {
  tokenContractAddress: string;
  from: string;
  to: string;
  amount: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.from);

  const tokenIdBytes = decodeContractAddress(opts.tokenContractAddress);
  const tokenScAddress = xdr.ScAddress.scAddressTypeContract(tokenIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.from).toScVal();
  const toScVal = new Address(opts.to).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: tokenScAddress,
      functionName: "transfer",
      args: [fromScVal, toScVal, amountScVal],
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

export async function prepareStreamerPauseInvocation(opts: {
  contractAddress: string;
  invokerAddress: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.invokerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "pause",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}

export async function prepareStreamerUnpauseInvocation(opts: {
  contractAddress: string;
  invokerAddress: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.invokerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "unpause",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}

export async function prepareStreamerRetrieveUnvestedInvocation(opts: {
  contractAddress: string;
  invokerAddress: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.invokerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "retrieve_unvested",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}

export async function prepareStreamerTopUpInvocation(opts: {
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
      functionName: "top_up",
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

// Maximum ledger delta that a Soroban storage entry can be extended, i.e.
// the farthest future ledger an `approve` expiration can target.
// Current protocol value: 3110400 ledgers (~180 days at 5s/ledger).
const MAX_APPROVAL_LEDGER_DELTA = 3_110_400;
const APPROVAL_LEDGER_BUFFER = 10;

export async function prepareTokenApproveInvocation(opts: {
  tokenContractAddress: string;
  from: string;
  spender: string;
  amount: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const [sourceAcct, latestLedger] = await Promise.all([
    server.getAccount(opts.from),
    server.getLatestLedger(),
  ]);

  const tokenIdBytes = decodeContractAddress(opts.tokenContractAddress);
  const tokenScAddress = xdr.ScAddress.scAddressTypeContract(tokenIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.from).toScVal();
  const spenderScVal = new Address(opts.spender).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });
  // Approval expirations must be within the network's max entry TTL.
  // Using U32_MAX caused "live_until is greater than max".
  const expirationLedger =
    latestLedger.sequence + MAX_APPROVAL_LEDGER_DELTA - APPROVAL_LEDGER_BUFFER;
  const expirationScVal = nativeToScVal(expirationLedger, { type: "u32" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: tokenScAddress,
      functionName: "approve",
      args: [fromScVal, spenderScVal, amountScVal, expirationScVal],
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

export async function prepareSubscriptionUnsubscribeInvocation(opts: {
  contractAddress: string;
  subscriberAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.subscriberAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "unsubscribe",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareSubscriptionSubscribeInvocation(opts: {
  contractAddress: string;
  subscriberAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.subscriberAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "subscribe",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareSubscriptionChargeInvocation(opts: {
  contractAddress: string;
  adminAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.adminAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "charge",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareSubscriptionChargeByRelayerUnsigned(opts: {
  contractAddress: string;
  relayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.relayerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function prepareSubscriptionSetRelayerInvocation(opts: {
  contractAddress: string;
  adminAddress: string;
  newRelayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.adminAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "set_relayer",
      args: [new Address(opts.newRelayerAddress).toScVal()],
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

function payrollRecipientsToScVal(
  recipients: Array<{ address: string; amount: string }>,
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("address", { type: "symbol" }),
          val: new Address(r.address).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("amount", { type: "symbol" }),
          val: nativeToScVal(BigInt(r.amount), { type: "i128" }),
        }),
      ]),
    ),
  );
}

export async function preparePayrollChargeInvocation(opts: {
  contractAddress: string;
  adminAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.adminAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "charge",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function preparePayrollChargeByRelayerUnsigned(opts: {
  contractAddress: string;
  relayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.relayerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function preparePayrollUpdateRecipientsInvocation(opts: {
  contractAddress: string;
  adminAddress: string;
  recipients: Array<{ address: string; amount: string }>;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.adminAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "update_recipients",
      args: [payrollRecipientsToScVal(opts.recipients)],
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

export async function preparePayrollSetRelayerInvocation(opts: {
  contractAddress: string;
  adminAddress: string;
  newRelayerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.adminAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "set_relayer",
      args: [new Address(opts.newRelayerAddress).toScVal()],
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

export async function preparePayrollUnsubscribeInvocation(opts: {
  contractAddress: string;
  employerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.employerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "unsubscribe",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}

export async function preparePayrollSubscribeInvocation(opts: {
  contractAddress: string;
  employerAddress: string;
}): Promise<PreparedInvokeTx> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.employerAddress);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "subscribe",
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
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), tx: assembled };
}
