import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type PreparedInvoke = {
  xdr: string;
};

function decodeContractAddress(addr: string): Buffer {
  if (StrKey.isValidContract(addr)) {
    return StrKey.decodeContract(addr);
  }
  const raw = Buffer.from(addr, "base64");
  if (raw.length === 32) {
    return raw;
  }
  throw new AppError("VALIDATION", `Invalid contract address: ${addr}`);
}

export async function prepareDistributeTx(opts: {
  contractAddress: string;
  amount: string;
  sourceAccount: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.sourceAccount);

  const contractIdBytes = decodeContractAddress(opts.contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(opts.sourceAccount).toScVal();
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
