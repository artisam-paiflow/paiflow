import { afterEach, describe, expect, it, vi } from "vitest";

// Relative import: the module reads process.env directly and must stay free
// of SDK imports so it loads under vitest's node environment.
import {
  isExpiredSession,
  isLiveSession,
  isPairingFresh,
  PAIRING_STALE_MARGIN_MS,
  pairingExpiresAt,
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
