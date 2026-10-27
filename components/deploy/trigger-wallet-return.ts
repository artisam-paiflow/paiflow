import { mobileWalletLink } from "./mobile-wallet-links";

export const PENDING_WALLET_RETURN_KEY = "paiflow_pending_wc";
export type PendingWalletReturn = {
  /** Public UI action identity, not a server allowance token or signed envelope. */
  boundAction: string;
  network: "testnet" | "mainnet";
  timestamp: number;
  walletId: string;
  pairingTopic: string;
};

/** Only the exact action that initiated this pairing can resume after reload. */
export function pendingWalletReturn(
  value: unknown,
  boundAction: string,
  network: "testnet" | "mainnet",
  now: number = Date.now(),
): PendingWalletReturn | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<PendingWalletReturn>;
  if (
    data.boundAction !== boundAction ||
    data.network !== network ||
    typeof data.timestamp !== "number" ||
    !Number.isFinite(data.timestamp) ||
    now - data.timestamp > 120000 ||
    data.timestamp > now + 5000 ||
    typeof data.walletId !== "string" ||
    !mobileWalletLink(data.walletId) ||
    typeof data.pairingTopic !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(data.pairingTopic)
  )
    return null;
  return {
    boundAction,
    network,
    timestamp: data.timestamp,
    walletId: data.walletId,
    pairingTopic: data.pairingTopic,
  };
}
