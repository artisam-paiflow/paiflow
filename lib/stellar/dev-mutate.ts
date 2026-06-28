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

function string(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
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

async function readPayerDevPayment(contractAddress: string): Promise<{
  recipient?: string;
  amountStroops: string;
  percentageBps: number;
}> {
  const server = sorobanRpc();
  const source = relayerAddressOrThrow();
  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch {
    throw new AppError("INSUFFICIENT_FUNDS", `Relayer account ${source} is not funded`);
  }

  const buildTx = (functionName: string) =>
    new TransactionBuilder(sourceAcct, {
      fee: BASE_FEE,
      networkPassphrase: stellarPassphrase(),
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractAddress,
          function: functionName,
          args: [],
        }),
      )
      .setTimeout(30)
      .build();

  const read = async (functionName: string) => {
    const sim = await server.simulateTransaction(buildTx(functionName));
    if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
      throw new AppError(
        "UPSTREAM_RPC",
        `${functionName}() simulation failed for ${contractAddress}`,
      );
    }
    return sim.result.retval;
  };

  const recipientVal = await read("recipient");
  const amountVal = await read("configured_amount");
  const bpsVal = await read("percentage_bps");

  const recipientNative = scValToNative(recipientVal) as string | null | undefined;
  const amountNative = scValToNative(amountVal) as bigint | number | string;
  const bpsNative = scValToNative(bpsVal) as number;

  return {
    recipient: recipientNative ? String(recipientNative) : undefined,
    amountStroops: String(amountNative),
    percentageBps: bpsNative,
  };
}

export async function updatePaymentByRelayer(
  contractAddress: string,
  opts: { recipient?: string; amountStroops?: string; percentageBps?: number },
): Promise<DevMutateResult> {
  const current = await readPayerDevPayment(contractAddress);
  const recipient = opts.recipient ?? current.recipient;
  const amountStroops = opts.amountStroops ?? current.amountStroops;
  const percentageBps = opts.percentageBps ?? current.percentageBps;

  if (!recipient) {
    throw new AppError("VALIDATION", "Recipient is required for update_payment");
  }

  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_payment", [
    addr(caller),
    addr(recipient),
    i128(amountStroops),
    u32(percentageBps),
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

// ── CASH_OUT_DEV ──────────────────────────────────────────────────────────────

export function updateBankByRelayer(
  contractAddress: string,
  opts: { accountName: string; accountNumber: string; bankCode: string },
): Promise<DevMutateResult> {
  const caller = relayerAddressOrThrow();
  return invokeByRelayer(contractAddress, "update_bank", [
    addr(caller),
    string(opts.accountName),
    string(opts.accountNumber),
    string(opts.bankCode),
  ]);
}

// ── Treasury refund ───────────────────────────────────────────────────────────

/**
 * Refund USDC from the off-ramp treasury back to an on-chain source address.
 * Used when the PDAX off-ramp fails before the trade executes, so the crypto is
 * still in the treasury. The caller supplies the SAC asset contract address.
 */
export async function refundFromTreasury(opts: {
  destination: string;
  amountStroops: string;
  assetContractAddress: string;
}): Promise<DevMutateResult> {
  const kp = relayerKeypair();
  const server = sorobanRpc();

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
    contract: opts.assetContractAddress,
    function: "transfer",
    args: [addr(kp.publicKey()), addr(opts.destination), i128(opts.amountStroops)],
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
    throw new AppError("UPSTREAM_RPC", `treasury refund simulation failed: ${sim.error}`);
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
        errorMessage: "Refund transaction failed on the network",
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "FAILED", txHash: send.hash, errorMessage: "Timed out waiting for finality" };
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
