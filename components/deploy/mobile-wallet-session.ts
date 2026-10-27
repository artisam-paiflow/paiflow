import { findMobileWallet } from "./mobile-wallet-registry";
import { isLiveSession, stellarChainId } from "./wallet-connect-config";

export type MobileWalletSession = { topic: string; walletId: string; address: string };

type Session = {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[]; methods: string[] }>;
};

/** Restore only the exact topic and account previously approved here. */
export function approvedMobileSession(
  stored: unknown,
  sessions: Session[],
  network: "testnet" | "mainnet",
): MobileWalletSession | null {
  if (!stored || typeof stored !== "object") return null;
  const value = stored as Partial<MobileWalletSession>;
  if (
    typeof value.topic !== "string" ||
    typeof value.address !== "string" ||
    typeof value.walletId !== "string" ||
    !findMobileWallet(value.walletId)
  )
    return null;
  if (
    !hasApprovedWalletConnectSession(
      { topic: value.topic, address: value.address },
      sessions,
      network,
    )
  )
    return null;
  return { topic: value.topic, walletId: value.walletId!, address: value.address };
}

/** Revalidate an exact approved topic/account; peer metadata is never identity. */
export function hasApprovedWalletConnectSession(
  value: { topic: string; address: string },
  sessions: Session[],
  network: "testnet" | "mainnet",
): boolean {
  const session = sessions.find((candidate) => candidate.topic === value.topic);
  if (!isLiveSession(session)) return false;
  const chain = stellarChainId(network);
  const namespace = session?.namespaces.stellar ?? session?.namespaces[chain];
  if (
    !namespace?.methods.includes("stellar_signXDR") ||
    !namespace.accounts.includes(`${chain}:${value.address}`)
  )
    return false;
  return true;
}
