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
    !["freighter", "lobstr", "xbull"].includes(value.walletId ?? "")
  )
    return null;
  const session = sessions.find((candidate) => candidate.topic === value.topic);
  if (!isLiveSession(session)) return null;
  const chain = stellarChainId(network);
  const namespace = session?.namespaces.stellar ?? session?.namespaces[chain];
  if (
    !namespace?.methods.includes("stellar_signXDR") ||
    !namespace.accounts.includes(`${chain}:${value.address}`)
  )
    return null;
  return { topic: value.topic, walletId: value.walletId!, address: value.address };
}
