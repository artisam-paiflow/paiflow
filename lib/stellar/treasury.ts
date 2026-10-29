import "server-only";
import {
  Address,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { horizon, sorobanRpc, withRelayerLock } from "@/lib/stellar/client";
import {
  offRampTreasuryAddress,
  stellarPassphrase,
  stellarRelayerAddress,
  stellarRelayerSecretKey,
} from "@/lib/env";
import { AppError } from "@/lib/errors";
export type TreasuryTransferResult = {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  errorMessage?: string;
};
export type NativeDepositResult = {
  status: "SUCCESS" | "FAILED" | "UNKNOWN";
  txHash: string;
  errorMessage?: string;
};

function addr(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}

function i128(n: string | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "i128" });
}

function relayerKeypair(): Keypair {
  const secret = stellarRelayerSecretKey();
  if (!secret) {
    throw new AppError("INTERNAL", "STELLAR_RELAYER_SECRET_KEY is not configured");
  }
  return Keypair.fromSecret(secret);
}

function relayerAddressOrThrow(): string {
  const a = stellarRelayerAddress();
  if (!a) throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
  return a;
}

// Off-ramp treasury reads and transfers.

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
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError(
      "UPSTREAM_RPC",
      `balance simulation failed for ${assetContractAddress}: ${sim.error}`,
    );
  }
  if (!sim.result?.retval) {
    throw new AppError(
      "UPSTREAM_RPC",
      `balance simulation failed for ${assetContractAddress}: no return value`,
    );
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
 * Poll Horizon for a transaction by hash, with a short deadline to give the
 * ledger time to ingest a tx that was accepted around the same time a submit
 * timeout or network error occurred.
 */
async function lookupHorizonTransaction(
  server: Horizon.Server,
  txHash: string,
  maxWaitMs = 10_000,
): Promise<{ successful: boolean } | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const record = await server.transactions().transaction(txHash).call();
      if (record && typeof record.successful === "boolean") {
        return { successful: record.successful };
      }
    } catch {
      // Transaction may not have been ingested yet, or Horizon returned a
      // transient error. Keep polling briefly.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Deposit native XLM from the relayer/treasury account to a provider deposit
 * address with a numeric memo/tag. Used for the native XLM -> PHP off-ramp flow
 * where the provider requires a memo to credit the institutional balance.
 *
 * Horizon's submitTransaction can throw (timeout, connection reset, proxy 5xx)
 * even when the transaction was accepted by the network. When that happens we
 * look up the built transaction by its hash before returning, so the caller can
 * distinguish "confirmed failed" from "unknown/possibly succeeded" and avoid
 * retrying or refunding in the latter case.
 */
export async function depositNativeToProvider(opts: {
  destination: string;
  memo: string;
  amountStroops: string;
}): Promise<NativeDepositResult> {
  const kp = relayerKeypair();
  const source = kp.publicKey();
  const memoId = parseMemoId(opts.memo);
  const server = horizon();

  let builtTxHash: string | undefined;

  try {
    // Relayer-source lane, not a channel: a classic payment whose source is the
    // treasury account itself (there is no Soroban auth entry to move to a channel).
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
      builtTxHash = tx.hash().toString("hex");
      return server.submitTransaction(tx);
    });

    if (!submitResult.successful) {
      return {
        status: "FAILED",
        txHash: submitResult.hash,
        errorMessage: `submitTransaction failed: ${JSON.stringify(submitResult)}`,
      };
    }
    return { status: "SUCCESS", txHash: submitResult.hash };
  } catch (err) {
    const txHash = builtTxHash;
    if (txHash) {
      // We built and signed the tx, so the error happened at submit time.
      // Horizon may have accepted the tx even though the client threw (timeout,
      // connection reset, proxy error), so look it up before giving up.
      const found = await lookupHorizonTransaction(server, txHash);
      if (found) {
        return found.successful
          ? { status: "SUCCESS", txHash }
          : { status: "FAILED", txHash, errorMessage: "Transaction failed on the network" };
      }
      return {
        status: "UNKNOWN",
        txHash,
        errorMessage: `Deposit submission failed with ambiguous outcome: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // Error happened before we built/signed the tx (e.g. loadAccount failed),
    // so no payment could have been submitted. Report a genuine failure so the
    // caller can retry or refund as appropriate.
    return {
      status: "FAILED",
      txHash: "",
      errorMessage: `Deposit preparation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
}): Promise<TreasuryTransferResult> {
  const kp = relayerKeypair();
  const server = sorobanRpc();

  // Stays on the relayer-source lane, not a channel: this moves the treasury's
  // own funds out of the relayer account, so the relayer stays the transaction
  // source and its authorization stays the envelope signature. Low volume.
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
