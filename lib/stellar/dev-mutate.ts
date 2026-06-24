import "server-only";
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc } from "./client";
import { stellarPassphrase, stellarRelayerAddress, stellarRelayerSecretKey } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Relayer-signed mutations for the dev (`_DEV`) contracts. The setters are
 * gated by `require_admin_or_relayer`, so the backend relayer key both
 * authenticates as `caller` and signs the transaction. This is the runtime
 * surface that lets a web2 developer fill / change a deployed dev flow via the
 * API without the deployer signing each change.
 */

export type DevRecipient = { address: string; bps: number; amount: string };

export type DevMutateResult = {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  errorMessage?: string;
};

function addr(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}

function i128(n: string | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "i128" });
}

function u32(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

function u64(n: number | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "u64" });
}

function symbol(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

function recipientsVec(recipients: DevRecipient[]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: symbol("address"), val: addr(r.address) }),
        new xdr.ScMapEntry({ key: symbol("amount"), val: i128(r.amount) }),
        new xdr.ScMapEntry({ key: symbol("bps"), val: u32(r.bps) }),
      ]),
    ),
  );
}

function relayerKeypair(): Keypair {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  return Keypair.fromSecret(secret);
}

/** Build, simulate, sign (relayer) and submit a contract invocation. */
async function invokeByRelayer(
  contractAddress: string,
  functionName: string,
  args: xdr.ScVal[],
): Promise<DevMutateResult> {
  const server = sorobanRpc();
  const kp = relayerKeypair();

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(kp.publicKey());
  } catch {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Relayer account ${kp.publicKey()} is not funded or does not exist`,
    );
  }

  const op = Operation.invokeContractFunction({
    contract: contractAddress,
    function: functionName,
    args,
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
    throw new AppError(
      "UPSTREAM_RPC",
      `${functionName}() simulation failed for ${contractAddress}: ${sim.error}`,
    );
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(kp);

  const send = await server.sendTransaction(assembled);
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
    if (got.status === "SUCCESS") return { status: "SUCCESS", txHash: send.hash };
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

function relayerAddressOrThrow(): string {
  const a = stellarRelayerAddress();
  if (!a) throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  return a;
}

// ── PAYER_DEV ───────────────────────────────────────────────────────────────

export function updatePaymentByRelayer(
  contractAddress: string,
  opts: { recipient: string; amountStroops: string; percentageBps: number },
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_payment", [
    addr(caller),
    addr(opts.recipient),
    i128(opts.amountStroops),
    u32(opts.percentageBps),
  ]);
}

export function setPayerAssetByRelayer(
  contractAddress: string,
  asset: string,
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "set_asset", [addr(caller), addr(asset)]);
}

// ── SPLITTER_DEV ──────────────────────────────────────────────────────────────

export function updateRecipientsByRelayer(
  contractAddress: string,
  recipients: DevRecipient[],
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_recipients", [
    addr(caller),
    recipientsVec(recipients),
  ]);
}

// ── SUBSCRIPTION_DEV ──────────────────────────────────────────────────────────

export function updateSubscriberByRelayer(
  contractAddress: string,
  subscriber: string,
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_subscriber", [addr(caller), addr(subscriber)]);
}

export function setSubscriptionAmountByRelayer(
  contractAddress: string,
  amountStroops: string,
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "set_amount", [addr(caller), i128(amountStroops)]);
}

export function updateScheduleByRelayer(
  contractAddress: string,
  opts: { startTs: number; intervalSeconds: number; endTs: number },
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_schedule", [
    addr(caller),
    u64(opts.startTs),
    u64(opts.intervalSeconds),
    u64(opts.endTs),
  ]);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Read `is_configured()` from any dev contract via simulation. */
export async function readDevIsConfigured(contractAddress: string): Promise<boolean> {
  const server = sorobanRpc();
  const source = relayerAddressOrThrow();
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch {
    throw new AppError("INSUFFICIENT_FUNDS", `Relayer account ${source} is not funded`);
  }
  const op = Operation.invokeContractFunction({
    contract: contractAddress,
    function: "is_configured",
    args: [],
  });
  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    throw new AppError("UPSTREAM_RPC", `is_configured() simulation failed for ${contractAddress}`);
  }
  return scValToNative(sim.result.retval) === true;
}
