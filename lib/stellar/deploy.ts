import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  hash,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { sorobanRpc } from "./client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { ContractParams } from "@/lib/flows/to-params";
import { constructorArgs } from "./scval";

export type PreparedDeploy = {
  xdr: string;
  contractAddress: string;
  salt: Buffer;
};

/** Build & simulate a Soroban contract creation tx. Returns unsigned XDR. */
export async function prepareDeployTx(opts: {
  wasmHash: string; // hex
  sourceAccount: string; // G... user pubkey
  params: ContractParams;
}): Promise<PreparedDeploy> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.sourceAccount);
  const wasmHashBuf = Buffer.from(opts.wasmHash, "hex");
  if (wasmHashBuf.length !== 32) {
    throw new AppError("VALIDATION", "wasmHash must be 32 bytes");
  }
  const salt = randomBytes(32);

  const args = constructorArgs(opts.params, opts.sourceAccount);

  const op = Operation.createCustomContract({
    address: new Address(opts.sourceAccount),
    wasmHash: wasmHashBuf,
    salt,
    constructorArgs: args,
  });

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

  // Pre-compute the contract address (deterministic from source + salt + network).
  const contractAddress = computeContractAddress(opts.sourceAccount, salt);

  return { xdr: assembled.toXDR(), contractAddress, salt };
}

function computeContractAddress(sourceAccount: string, salt: Buffer): string {
  // Per CAP-46, contract IDs from address+salt are SHA256(networkId || preimage).
  // For Pink Raft we read the address back from the tx result on submit; this helper
  // returns the user-facing salt-derived expected address using SDK utilities.
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(stellarPassphrase())),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(sourceAccount).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  const idBytes = hash(preimage.toXDR());
  return Address.contract(idBytes).toString();
}

export type SubmitResult = {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  contractAddress?: string;
  errorMessage?: string;
};

/** Submit a signed XDR, poll until finalized. */
export async function submitDeployTx(signedXdr: string): Promise<SubmitResult> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
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
      const created = extractCreatedContract(got);
      return {
        status: "SUCCESS",
        txHash: send.hash,
        contractAddress: created ?? undefined,
      };
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
  return { status: "FAILED", txHash: send.hash, errorMessage: "Timed out waiting for finality" };
}

function extractCreatedContract(tx: rpc.Api.GetSuccessfulTransactionResponse): string | null {
  try {
    const retval = tx.returnValue;
    if (!retval) return null;
    if (retval.switch().name === "scvAddress") {
      return Address.fromScAddress(retval.address()).toString();
    }
    return null;
  } catch {
    return null;
  }
}
