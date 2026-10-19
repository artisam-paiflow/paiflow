import { StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { LanternWalletError } from "./lantern-wallet-error";

export type LanternProvider = {
  isLantern: true;
  apiVersion: 1;
  isConnected(): Promise<{ isConnected: boolean; apiVersion?: number }>;
  requestAccess(): Promise<{ address: string }>;
  getAddress(): Promise<{ address: string }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  signTransaction(
    xdr: string,
    options: { address: string; networkPassphrase: string },
  ): Promise<unknown>;
  on(event: "change", listener: (data: Record<string, unknown>) => void): void;
  off(event: "change", listener: (data: Record<string, unknown>) => void): void;
};

/** Desktop extension only: the Apps-tab bridge is a separate integration. */
export function desktopLanternProvider(): LanternProvider | null {
  if (typeof window === "undefined" || window.top !== window.self) return null;
  const value = (window as unknown as { lantern?: unknown }).lantern;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.isLantern !== true || record.apiVersion !== 1) return null;
  if (
    ![
      "isConnected",
      "requestAccess",
      "getAddress",
      "getNetwork",
      "signTransaction",
      "on",
      "off",
    ].every((key) => typeof record[key] === "function")
  )
    return null;
  return value as LanternProvider;
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
): { signedTxXdr: string; signerAddress: string } {
  if (
    !value ||
    typeof value !== "object" ||
    !("signedTxXdr" in value) ||
    !("signerAddress" in value)
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  const signedTxXdr = value.signedTxXdr;
  const signerAddress = value.signerAddress;
  if (
    ("error" in value && value.error != null) ||
    typeof signedTxXdr !== "string" ||
    !signedTxXdr ||
    typeof signerAddress !== "string"
  )
    throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
  if (signerAddress !== address) throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
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
