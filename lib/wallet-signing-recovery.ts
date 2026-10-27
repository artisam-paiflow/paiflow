import { LanternWalletError } from "@/lib/stellar/lantern-wallet-error";
/** Public metadata only. Absent metadata denotes an existing, submitted record. */
export type SigningRecovery = {
  phase?: "signing" | "submitted";
  attemptId?: string;
};
export type SigningAttempt = { txHash: string; phase: "signing"; attemptId: string };

export function readSigningRecovery(value: object): SigningRecovery {
  if (!("phase" in value) && !("attemptId" in value)) return {};
  if (
    !("phase" in value) ||
    (value.phase !== "signing" && value.phase !== "submitted") ||
    !("attemptId" in value) ||
    typeof value.attemptId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.attemptId)
  )
    throw new Error("Stored signing status is invalid. Resolve it before signing again.");
  return { phase: value.phase, attemptId: value.attemptId };
}

export function isSigningAttempt(
  actual: ({ txHash: string } & SigningRecovery) | null,
  expected: SigningAttempt,
): boolean {
  return (
    actual?.txHash === expected.txHash &&
    actual.phase === "signing" &&
    actual.attemptId === expected.attemptId
  );
}

/** Only an explicit wallet refusal proves no signed result was returned.
 * Semantic unknown-outcome codes take priority over a kit's numeric wrapper.
 */
export function isExplicitSigningRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (error instanceof LanternWalletError) return error.code === "LANTERN_REJECTED";
  const record = error as Record<string, unknown>;
  const semantic = record.ext;
  if (semantic !== undefined && semantic !== "user_rejected") return false;
  const code = record.code;
  return semantic === "user_rejected" || code === "user_rejected" || code === -4 || code === 4001;
}

/** The surface retains its own storage protocol (including scoped allowance intents). */
export async function signWithRecovery(options: {
  network: "testnet" | "mainnet";
  xdr: string;
  address: string;
  networkPassphrase: string;
  check: () => void;
  save: (attempt: SigningAttempt) => void;
  read: () => ({ txHash: string } & SigningRecovery) | null;
  clearRejected: (attempt: SigningAttempt) => void;
  sign: () => Promise<{ signedTxXdr: string }>;
}): Promise<{ signedTxXdr: string; attempt: SigningAttempt }> {
  const { assertWalletNetwork, preparedWalletTransactionHash, signedWalletTransactionHash } =
    await import("@/lib/stellar/wallet-signature");
  options.check();
  assertWalletNetwork(options.network, options.networkPassphrase);
  const attempt: SigningAttempt = {
    txHash: preparedWalletTransactionHash(
      options.network,
      options.xdr,
      options.address,
      options.networkPassphrase,
    ),
    phase: "signing",
    attemptId: crypto.randomUUID(),
  };
  options.save(attempt);
  if (!isSigningAttempt(options.read(), attempt))
    throw new Error("Signing status could not be saved. No signature was requested.");
  options.check();
  let signed: { signedTxXdr: string };
  try {
    signed = await options.sign();
  } catch (error) {
    // An aborted Promise.race may already have released the action lock. Its
    // late rejection cannot mutate recovery outside that admission boundary.
    options.check();
    if (isExplicitSigningRejection(error) && isSigningAttempt(options.read(), attempt))
      options.clearRejected(attempt);
    throw error;
  }
  options.check();
  if (!isSigningAttempt(options.read(), attempt))
    throw new Error("Signing attempt ended or changed. No transaction was submitted.");
  const hash = signedWalletTransactionHash(
    options.network,
    options.xdr,
    signed.signedTxXdr,
    options.address,
    options.networkPassphrase,
  );
  if (hash !== attempt.txHash) throw new Error("Wallet changed the prepared transaction hash.");
  return { signedTxXdr: signed.signedTxXdr, attempt };
}
