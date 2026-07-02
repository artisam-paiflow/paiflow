import "server-only";
import { randomBytes } from "node:crypto";
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { horizon, sorobanRpc, withRelayerLock } from "./client";
import {
  offRampTreasuryAddress,
  stellarPassphrase,
  stellarRelayerAddress,
  stellarRelayerSecretKey,
  stellarWasmHash,
} from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Relayer-signed mutations for the dev (`_DEV`) contracts. The setters are
 * gated by `require_admin_or_relayer`, so the backend relayer key both
 * authenticates as `caller` and signs the transaction. This is the runtime
 * surface that lets a web2 developer fill / change a deployed dev flow via the
 * API without the deployer signing each change.
 */

export type DevRecipient = {
  address: string;
  bps: number;
  amount: string;
  isCashOut?: boolean;
};

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

function bool(b: boolean): xdr.ScVal {
  return nativeToScVal(b, { type: "bool" });
}

function recipientsVec(recipients: DevRecipient[]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: symbol("address"), val: addr(r.address) }),
        new xdr.ScMapEntry({ key: symbol("amount"), val: i128(r.amount) }),
        new xdr.ScMapEntry({ key: symbol("bps"), val: u32(r.bps) }),
        new xdr.ScMapEntry({ key: symbol("is_cash_out"), val: bool(r.isCashOut ?? false) }),
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

type PendingTx = { status: "PENDING"; txHash: string };

/** Build, simulate, sign (relayer) and submit a contract invocation. */
async function buildAndSendByRelayer(
  contractAddress: string,
  functionName: string,
  args: xdr.ScVal[],
): Promise<PendingTx> {
  const server = sorobanRpc();
  const kp = relayerKeypair();

  // Serialize account-load -> sign -> submit against the shared relayer account
  // so concurrent invocations don't race the same sequence number (txBadSeq).
  const send = await withRelayerLock(async () => {
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

    return server.sendTransaction(assembled);
  });

  if (send.status === "ERROR") {
    throw new AppError(
      "UPSTREAM_RPC",
      `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    );
  }

  return { status: "PENDING", txHash: send.hash };
}

/** Build, simulate, sign (relayer), submit, and wait for finality. */
async function invokeByRelayer(
  contractAddress: string,
  functionName: string,
  args: xdr.ScVal[],
): Promise<DevMutateResult> {
  const { txHash } = await buildAndSendByRelayer(contractAddress, functionName, args);
  const server = sorobanRpc();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(txHash);
    if (got.status === "SUCCESS") return { status: "SUCCESS", txHash };
    if (got.status === "FAILED") {
      return {
        status: "FAILED",
        txHash,
        errorMessage: "Transaction failed on the network",
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "FAILED", txHash, errorMessage: "Timed out waiting for finality" };
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

/** Submit an update_recipients call and return immediately with a pending txHash. */
export function submitUpdateRecipientsByRelayer(
  contractAddress: string,
  recipients: DevRecipient[],
): Promise<PendingTx> {
  const caller = relayerAddressOrThrow();
  return buildAndSendByRelayer(contractAddress, "update_recipients", [
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

/** Submit a set_amount call and return immediately with a pending txHash. */
export function submitSetSubscriptionAmountByRelayer(
  contractAddress: string,
  amountStroops: string,
): Promise<PendingTx> {
  const caller = relayerAddressOrThrow();
  return buildAndSendByRelayer(contractAddress, "set_amount", [addr(caller), i128(amountStroops)]);
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

export type DeployCashOutDevResult = {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  contractAddress?: string;
  errorMessage?: string;
};

export async function deployCashOutDevByRelayer(opts: {
  adminAddress: string;
  assetContractAddress: string;
  treasury: string;
  parent: string;
  accountName?: string;
  accountNumber?: string;
  bankCode?: string;
}): Promise<DeployCashOutDevResult> {
  const wasmHash = stellarWasmHash("CASH_OUT_DEV");
  if (!wasmHash) {
    throw new AppError("INTERNAL", "CASH_OUT_DEV WASM hash is not configured");
  }

  const server = sorobanRpc();
  const kp = relayerKeypair();

  const salt = randomBytes(32);
  const args = [
    addr(opts.adminAddress),
    addr(kp.publicKey()),
    addr(opts.assetContractAddress),
    addr(opts.treasury),
    addr(opts.parent),
    string(opts.accountName ?? ""),
    string(opts.accountNumber ?? ""),
    string(opts.bankCode ?? ""),
  ];

  // Serialize account-load -> sign -> submit against the shared relayer account.
  const send = await withRelayerLock(async () => {
    let sourceAcct;
    try {
      sourceAcct = await server.getAccount(kp.publicKey());
    } catch {
      throw new AppError(
        "INSUFFICIENT_FUNDS",
        `Relayer account ${kp.publicKey()} is not funded or does not exist`,
      );
    }

    const op = Operation.createCustomContract({
      address: new Address(kp.publicKey()),
      wasmHash: Buffer.from(wasmHash, "hex"),
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
      throw new AppError("UPSTREAM_RPC", `CASH_OUT_DEV deploy simulation failed: ${sim.error}`);
    }

    const assembled = rpc.assembleTransaction(tx, sim).build();
    assembled.sign(kp);

    return server.sendTransaction(assembled);
  });

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
      let contractAddress: string | undefined;
      try {
        const retval = got.returnValue;
        if (retval && retval.switch().name === "scvAddress") {
          contractAddress = Address.fromScAddress(retval.address()).toString();
        }
      } catch {
        contractAddress = undefined;
      }
      return { status: "SUCCESS", txHash: send.hash, contractAddress };
    }
    if (got.status === "FAILED") {
      return {
        status: "FAILED",
        txHash: send.hash,
        errorMessage: "Deploy transaction failed on the network",
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
 * Read the off-ramp treasury balance for a Stellar asset contract.
 * Used by the off-ramp cron to confirm a cash-out sink happened before trading.
 */
export async function getTreasuryBalance(assetContractAddress: string): Promise<bigint> {
  const treasury = offRampTreasuryAddress();
  if (!treasury) {
    throw new AppError("INTERNAL", "Off-ramp treasury address is not configured");
  }

  const server = sorobanRpc();
  const source = relayerAddressOrThrow();

  let sourceAcct;
  try {
    sourceAcct = await server.getAccount(source);
  } catch {
    throw new AppError("INSUFFICIENT_FUNDS", `Relayer account ${source} is not funded`);
  }

  const op = Operation.invokeContractFunction({
    contract: assetContractAddress,
    function: "balance",
    args: [addr(treasury)],
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
    throw new AppError("UPSTREAM_RPC", `balance simulation failed for ${assetContractAddress}`);
  }

  return BigInt(scValToNative(sim.result.retval));
}

function formatStroopsToXlm(stroops: string): string {
  const padded = stroops.padStart(8, "0");
  const integer = padded.slice(0, -7) || "0";
  const fraction = padded.slice(-7);
  return `${integer}.${fraction}`;
}

function parseMemoId(memo: string): string {
  const trimmed = memo.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new AppError("VALIDATION", `PDAX deposit memo must be numeric, got: ${memo}`);
  }
  // Stellar memo IDs are uint64; keep them as strings to avoid precision loss.
  return trimmed;
}

/**
 * Deposit native XLM from the relayer/treasury account to a provider deposit
 * address with a numeric memo/tag. Used for the native XLM -> PHP off-ramp flow
 * where the provider requires a memo to credit the institutional balance.
 */
export async function depositNativeToProvider(opts: {
  destination: string;
  memo: string;
  amountStroops: string;
}): Promise<DevMutateResult> {
  const kp = relayerKeypair();
  const source = kp.publicKey();
  const memoId = parseMemoId(opts.memo);

  const server = horizon();
  const submitResult = await withRelayerLock(async () => {
    const account = await server.loadAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellarPassphrase(),
    })
      .addOperation(
        Operation.payment({
          destination: opts.destination,
          asset: Asset.native(),
          amount: formatStroopsToXlm(opts.amountStroops),
        }),
      )
      .addMemo(Memo.id(memoId))
      .setTimeout(180)
      .build();
    tx.sign(kp);
    return server.submitTransaction(tx);
  });

  const txHash = submitResult.hash;
  if (!submitResult.successful) {
    return {
      status: "FAILED",
      txHash,
      errorMessage: `submitTransaction failed: ${JSON.stringify(submitResult)}`,
    };
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const tx = await server.transactions().transaction(txHash).call();
      if (tx.successful) return { status: "SUCCESS", txHash };
      return {
        status: "FAILED",
        txHash,
        errorMessage: `Deposit transaction failed on network: ${JSON.stringify(tx.result_meta_xdr)}`,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return {
    status: "FAILED",
    txHash,
    errorMessage: "Timed out waiting for deposit finality",
  };
}

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

  // Serialize account-load -> sign -> submit against the shared relayer account.
  const send = await withRelayerLock(async () => {
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

    return server.sendTransaction(assembled);
  });

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
