import { StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { LanternWalletError } from "./lantern-wallet-error";

/**
 * Paiflow's declared FAKE-PROVIDER contract, not an upstream Lantern API.
 * Browser activation stays disabled until upstream semantics are verified.
 * This marker and both response shapes are provisional test assumptions.
 */
export const PROVISIONAL_LANTERN_API = "paiflow-provisional-v1";
export type ProvisionalLanternProvider = {
  apiVersion: typeof PROVISIONAL_LANTERN_API;
  getAddress: (options: { networkPassphrase: string }) => Promise<unknown>;
  signTransaction: (
    transactionXdr: string,
    options: { address: string; networkPassphrase: string; submit: false },
  ) => Promise<unknown>;
};

export function provisionalLanternProvider(value: unknown): ProvisionalLanternProvider | null {
  if (!value || typeof value !== "object") return null;
  if (
    !("apiVersion" in value) ||
    value.apiVersion !== PROVISIONAL_LANTERN_API ||
    !("getAddress" in value) ||
    typeof value.getAddress !== "function" ||
    !("signTransaction" in value) ||
    typeof value.signTransaction !== "function"
  )
    return null;
  // Each return value is unknown and parsed before use. Method guards above
  // establish callability, not that a real provider implements this contract.
  return value as ProvisionalLanternProvider;
}

export function lanternIdentity(
  value: unknown,
  expectedPassphrase: string,
): { address: string; networkPassphrase: string } {
  if (
    !value ||
    typeof value !== "object" ||
    !("address" in value) ||
    !("networkPassphrase" in value)
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  const address = value.address;
  const networkPassphrase = value.networkPassphrase;
  if (
    ("error" in value && value.error != null) ||
    typeof address !== "string" ||
    !StrKey.isValidEd25519PublicKey(address) ||
    typeof networkPassphrase !== "string"
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  if (networkPassphrase !== expectedPassphrase)
    throw new LanternWalletError("LANTERN_WRONG_NETWORK");
  return { address, networkPassphrase };
}

export function lanternSignedResponse(
  value: unknown,
  address: string,
  passphrase: string,
): { signedTxXdr: string; signerAddress: string } {
  if (
    !value ||
    typeof value !== "object" ||
    !("signedTxXdr" in value) ||
    !("signerAddress" in value) ||
    !("networkPassphrase" in value)
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  const signedTxXdr = value.signedTxXdr;
  const signerAddress = value.signerAddress;
  const networkPassphrase = value.networkPassphrase;
  if (
    ("error" in value && value.error != null) ||
    typeof signedTxXdr !== "string" ||
    !signedTxXdr ||
    typeof signerAddress !== "string" ||
    typeof networkPassphrase !== "string"
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  if (signerAddress !== address) throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
  if (networkPassphrase !== passphrase) throw new LanternWalletError("LANTERN_WRONG_NETWORK");
  return { signedTxXdr, signerAddress };
}

/** Refuse a source mismatch before the provider is asked to sign anything. */
export function assertLanternTransactionSource(
  unsignedXdr: string,
  address: string,
  passphrase: string,
): void {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(unsignedXdr, passphrase);
  } catch {
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  }
  if (!(tx instanceof Transaction)) throw new LanternWalletError("LANTERN_UNSUPPORTED");
  if (tx.source !== address) throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
}
