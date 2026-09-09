import { afterEach, describe, expect, it, vi } from "vitest";

// Relative import: the module reads process.env directly and must stay free
// of SDK imports so it loads under vitest's node environment.
import {
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
