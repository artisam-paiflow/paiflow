import { afterEach, describe, expect, it, vi } from "vitest";

// Relative import: the module reads process.env directly and must stay free
// of SDK imports so it loads under vitest's node environment.
import {
  isExpiredSession,
  isLiveSession,
  isPairingFresh,
  PAIRING_STALE_MARGIN_MS,
  pairingExpiresAt,
  sessionHasChain,
  sessionMatchesWallet,
  stellarChainId,
  WALLET_CONNECT_UNCONFIGURED,
  walletConnectProjectId,
} from "../../../components/deploy/wallet-connect-config";

const VAR = "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("walletConnectProjectId", () => {
  it("returns null when the variable is unset", () => {
    vi.stubEnv(VAR, undefined);
    expect(walletConnectProjectId()).toBeNull();
  });

  it("returns null for an empty value", () => {
    vi.stubEnv(VAR, "");
    expect(walletConnectProjectId()).toBeNull();
  });

  it("returns null for a whitespace-only value", () => {
    vi.stubEnv(VAR, "   ");
    expect(walletConnectProjectId()).toBeNull();
  });

  it("returns the id when set", () => {
    vi.stubEnv(VAR, "0123456789abcdef0123456789abcdef");
    expect(walletConnectProjectId()).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("WALLET_CONNECT_UNCONFIGURED", () => {
  it("names the variable so an operator can act on the toast", () => {
    expect(WALLET_CONNECT_UNCONFIGURED).toContain(VAR);
  });
});

describe("isLiveSession", () => {
  const NOW_MS = 1_700_000_000_000;
  const nowSec = Math.floor(NOW_MS / 1000);

  it("accepts a session with comfortable time left", () => {
    expect(isLiveSession({ expiry: nowSec + 7 * 24 * 3600 }, NOW_MS)).toBe(true);
  });

  it("rejects an expired session", () => {
    expect(isLiveSession({ expiry: nowSec - 1 }, NOW_MS)).toBe(false);
  });

  it("rejects a session inside the margin, so none can expire mid-handshake", () => {
    expect(isLiveSession({ expiry: nowSec + 30 }, NOW_MS)).toBe(false);
    expect(isLiveSession({ expiry: nowSec + 61 }, NOW_MS)).toBe(true);
  });

  it("rejects a row with no usable expiry rather than trusting it", () => {
    expect(isLiveSession({}, NOW_MS)).toBe(false);
    expect(isLiveSession(null, NOW_MS)).toBe(false);
    expect(isLiveSession(undefined, NOW_MS)).toBe(false);
    expect(isLiveSession({ expiry: undefined }, NOW_MS)).toBe(false);
  });
});

describe("isExpiredSession", () => {
  const NOW_MS = 1_700_000_000_000;
  const nowSec = Math.floor(NOW_MS / 1000);

  it("reports a session whose expiry has passed", () => {
    expect(isExpiredSession({ expiry: nowSec - 1 }, NOW_MS)).toBe(true);
  });

  it("is not the negation of isLiveSession: the margin is skipped, not destroyed", () => {
    // Declining to use a session is cheap; deleting one is not. A session with
    // 30s left must be passed over but kept.
    const inMargin = { expiry: nowSec + 30 };
    expect(isLiveSession(inMargin, NOW_MS)).toBe(false);
    expect(isExpiredSession(inMargin, NOW_MS)).toBe(false);
  });

  it("never destroys a row whose expiry cannot be read", () => {
    for (const row of [{}, { expiry: undefined }, null, undefined]) {
      expect(isLiveSession(row, NOW_MS)).toBe(false);
      expect(isExpiredSession(row, NOW_MS)).toBe(false);
    }
  });

  it("leaves a healthy session alone", () => {
    expect(isExpiredSession({ expiry: nowSec + 7 * 24 * 3600 }, NOW_MS)).toBe(false);
  });
});

describe("pairingExpiresAt", () => {
  const NOW_MS = 1_700_000_000_000;

  it("reads expiryTimestamp (seconds) out of a v2 URI", () => {
    const expiry = Math.floor(NOW_MS / 1000) + 300;
    const uri = `wc:abc123@2?relay-protocol=irn&symKey=deadbeef&expiryTimestamp=${expiry}`;
    expect(pairingExpiresAt(uri, NOW_MS)).toBe(expiry * 1000);
  });

  it("falls back to the SDK's five-minute ttl when the URI carries no expiry", () => {
    expect(pairingExpiresAt("wc:abc123@2?relay-protocol=irn&symKey=deadbeef", NOW_MS)).toBe(
      NOW_MS + 5 * 60 * 1000,
    );
  });

  it("falls back rather than trusting a malformed expiry", () => {
    for (const uri of [
      "wc:a@2?expiryTimestamp=",
      "wc:a@2?expiryTimestamp=0",
      "wc:a@2?expiryTimestamp=abc",
    ]) {
      expect(pairingExpiresAt(uri, NOW_MS)).toBe(NOW_MS + 5 * 60 * 1000);
    }
  });
});

describe("isPairingFresh", () => {
  const NOW_MS = 1_700_000_000_000;

  it("accepts a pairing with time to spare", () => {
    expect(isPairingFresh(NOW_MS + 4 * 60 * 1000, NOW_MS)).toBe(true);
  });

  it("rejects one that would expire mid-handshake", () => {
    // Pairing on page load means the URI can die before the visitor taps; the
    // margin forces a re-pair instead of handing a wallet a dead URI.
    expect(isPairingFresh(NOW_MS + PAIRING_STALE_MARGIN_MS - 1, NOW_MS)).toBe(false);
    expect(isPairingFresh(NOW_MS + PAIRING_STALE_MARGIN_MS + 1, NOW_MS)).toBe(true);
  });

  it("rejects an expired or unknown expiry", () => {
    expect(isPairingFresh(NOW_MS - 1, NOW_MS)).toBe(false);
    expect(isPairingFresh(undefined, NOW_MS)).toBe(false);
    expect(isPairingFresh(Number.NaN, NOW_MS)).toBe(false);
  });
});

describe("stellarChainId", () => {
  it("maps each network to its CAIP-2 chain", () => {
    expect(stellarChainId("testnet")).toBe("stellar:testnet");
    expect(stellarChainId("mainnet")).toBe("stellar:pubnet");
  });
});

describe("sessionHasChain", () => {
  it("accepts a session whose accounts carry the chain", () => {
    const session = {
      namespaces: { stellar: { accounts: ["stellar:testnet:GABC"] } },
    };
    expect(sessionHasChain(session, "stellar:testnet")).toBe(true);
  });

  it("accepts a session that declares the chain explicitly", () => {
    expect(
      sessionHasChain(
        { namespaces: { stellar: { chains: ["stellar:pubnet"] } } },
        "stellar:pubnet",
      ),
    ).toBe(true);
  });

  it("refuses a session scoped to the other network", () => {
    // After a mainnet cutover one origin serves both old testnet trigger pages
    // and new mainnet ones against the same per-origin session store.
    const testnet = { namespaces: { stellar: { accounts: ["stellar:testnet:GABC"] } } };
    expect(sessionHasChain(testnet, "stellar:pubnet")).toBe(false);
  });

  it("does not match on a chain that is merely a prefix", () => {
    const session = { namespaces: { stellar: { accounts: ["stellar:testnet2:GABC"] } } };
    expect(sessionHasChain(session, "stellar:testnet")).toBe(false);
  });

  it("fails safe when the namespace cannot be read", () => {
    for (const session of [
      null,
      undefined,
      {},
      { namespaces: {} },
      { namespaces: { stellar: {} } },
    ]) {
      expect(sessionHasChain(session, "stellar:testnet")).toBe(false);
    }
  });
});

describe("sessionMatchesWallet", () => {
  // A ranking signal over self-reported metadata, never an authorization check:
  // WalletConnect v2 gives a dApp no way to verify which wallet a session
  // belongs to, so callers must stay correct when this is wrong in either
  // direction.
  it("recognizes a peer that claims the tapped wallet", () => {
    expect(sessionMatchesWallet("Freighter", "freighter")).toBe(true);
    expect(sessionMatchesWallet("LOBSTR", "lobstr")).toBe(true);
    expect(sessionMatchesWallet("xBull Wallet", "xbull")).toBe(true);
  });

  it("does not recognize a different wallet", () => {
    expect(sessionMatchesWallet("LOBSTR", "freighter")).toBe(false);
    expect(sessionMatchesWallet("Freighter", "xbull")).toBe(false);
  });

  it("is spoofable, which is why callers must not treat it as proof", () => {
    // Any wallet can name itself whatever it likes. This asserts the known
    // limitation rather than pretending the match is trustworthy.
    expect(sessionMatchesWallet("Freighter Helper", "freighter")).toBe(true);
    expect(sessionMatchesWallet("definitely-not-lobstr", "lobstr")).toBe(true);
  });

  it("returns false for metadata it has no keyword for", () => {
    for (const name of ["", "Some Other Wallet", null, undefined]) {
      expect(sessionMatchesWallet(name, "freighter")).toBe(false);
    }
    expect(sessionMatchesWallet("Freighter", "unknown-wallet")).toBe(false);
  });
});
