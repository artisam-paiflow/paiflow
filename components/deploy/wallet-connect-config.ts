export const WALLET_CONNECT_UNCONFIGURED =
  "Mobile wallet connection is not configured on this deployment " +
  "(NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is unset). Use Freighter on desktop, " +
  "or ask the operator to set it.";

// Kept free of SDK imports so it loads under vitest's node environment.
// The access must stay a literal `process.env.NEXT_PUBLIC_…`: the bundler
// inlines NEXT_PUBLIC_* only when spelled out, so this cannot go through
// lib/env.ts (CLAUDE.md §14).
export function walletConnectProjectId(): string | null {
  const id = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;
  return id && id.trim() ? id : null;
}

// A stored WalletConnect session outlives the relay's record of it. Adopting a
// dead one is silent: the kit reuses it instead of opening the QR modal, then
// the wallet never prompts and the signing request hangs. Sessions live in
// IndexedDB (WALLET_CONNECT_V2_INDEXED_DB), which is per-origin, so one host
// can be stuck this way while another is fine. The margin keeps a session from
// expiring mid-handshake.
const SESSION_EXPIRY_MARGIN_SECONDS = 60;

export function isLiveSession(
  session: { expiry?: number } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!session || typeof session.expiry !== "number") return false;
  return session.expiry > Math.floor(nowMs / 1000) + SESSION_EXPIRY_MARGIN_SECONDS;
}

/**
 * Whether a stored session is provably dead and safe to drop from the store.
 *
 * Deliberately NOT the negation of isLiveSession: declining to *use* a session
 * is cheap and reversible, destroying one is neither. A session inside the
 * margin, or one whose expiry cannot be read, is skipped but kept — only a
 * numeric expiry that has actually passed earns deletion.
 */
export function isExpiredSession(
  session: { expiry?: number } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!session || typeof session.expiry !== "number") return false;
  return session.expiry <= Math.floor(nowMs / 1000);
}

// WalletConnect pairings are short-lived: core 2.11.2 creates them with a
// FIVE_MINUTES ttl. Creating one on page load keeps the wallet tap synchronous,
// but it also means the URI can die before the visitor ever taps, so the
// freshness of a pre-created pairing has to be checked before it is used.
const PAIRING_FALLBACK_TTL_MS = 5 * 60 * 1000;
/** Re-pair rather than hand a wallet a URI that expires mid-handshake. */
export const PAIRING_STALE_MARGIN_MS = 45_000;

/**
 * When a pairing URI stops being usable, in epoch ms.
 *
 * The v2 URI carries `expiryTimestamp` (seconds). A URI without one is assumed
 * to follow the SDK default measured from now, which errs short: assuming a
 * pairing is older than it is costs one re-pair, assuming it is younger hands
 * the wallet a dead URI and looks like the silent failure in #594.
 */
export function pairingExpiresAt(uri: string, nowMs: number = Date.now()): number {
  const raw = /[?&]expiryTimestamp=(\d+)/u.exec(uri)?.[1];
  const seconds = raw ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return nowMs + PAIRING_FALLBACK_TTL_MS;
  return seconds * 1000;
}

export function isPairingFresh(expiresAt: number | undefined, nowMs: number = Date.now()): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return false;
  return expiresAt > nowMs + PAIRING_STALE_MARGIN_MS;
}

/** CAIP-2 chain id for a Paiflow network. The server pins which one is live. */
export function stellarChainId(network: "testnet" | "mainnet"): string {
  return network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";
}

type SessionNamespaces = {
  namespaces?: { stellar?: { accounts?: string[]; chains?: string[] } };
};

/**
 * Whether a stored session actually authorizes the chain we are about to use.
 *
 * `Deployment.network` is a column while `STELLAR_NETWORK` is pinned per
 * environment, so after a cutover one origin serves both old testnet trigger
 * pages and new mainnet ones against the same per-origin session store. A
 * session scoped to the wrong chain is rejected by the wallet at signing time;
 * filtering here turns that into a fresh pairing instead.
 *
 * Accounts are `stellar:<chain>:<G…>`; `chains` may be absent, so both are
 * consulted and an unreadable session is treated as not matching.
 */
export function sessionHasChain(
  session: SessionNamespaces | null | undefined,
  chain: string,
): boolean {
  const stellar = session?.namespaces?.stellar;
  if (!stellar) return false;
  if (stellar.chains?.some((c) => c === chain)) return true;
  return Boolean(stellar.accounts?.some((account) => account.startsWith(`${chain}:`)));
}

// The peer name a wallet reports is free-form third-party metadata
// ("Freighter", "LOBSTR", "xBull Wallet"), so this is a keyword match rather
// than an identifier comparison.
const WALLET_PEER_KEYWORDS: Record<string, string> = {
  freighter: "freighter",
  lobstr: "lobstr",
  xbull: "xbull",
};

/**
 * Whether a session's peer *claims* to be the given wallet. A ranking signal —
 * never a trust decision.
 *
 * `peer.metadata.name` is self-reported by the wallet, and WalletConnect v2
 * gives a dApp no way to verify it: `peer.publicKey` binds to no registry we
 * consult, and Verify attests our own origin to the wallet rather than the
 * wallet to us. Any wallet can name itself "Freighter". So this must not decide
 * whether a session may be *used* — it only decides which of several equally
 * valid sessions is tried first (#598 review).
 *
 * It must also never *exclude* a session: an unrecognized name is a wallet we
 * have no keyword for, not a wallet that is wrong, and filtering on it broke the
 * return-from-wallet path.
 */
export function sessionMatchesWallet(
  peerName: string | null | undefined,
  walletId: string,
): boolean {
  const keyword = WALLET_PEER_KEYWORDS[walletId];
  if (!keyword || typeof peerName !== "string") return false;
  return peerName.toLowerCase().includes(keyword);
}
