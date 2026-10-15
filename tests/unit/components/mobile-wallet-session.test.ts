import { describe, expect, it } from "vitest";
import { approvedMobileSession } from "@/components/deploy/mobile-wallet-session";

const approved = { topic: "approved", walletId: "freighter", address: `G${"A".repeat(55)}` };
const live = {
  topic: approved.topic,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  namespaces: {
    stellar: { methods: ["stellar_signXDR"], accounts: [`stellar:testnet:${approved.address}`] },
  },
};

describe("approvedMobileSession", () => {
  it.each(["freighter", "lobstr", "xbull"])(
    "restores the exact approved session for registered wallet %s",
    (walletId) => {
      const selection = { ...approved, walletId };
      expect(approvedMobileSession(selection, [live], "testnet")).toEqual(selection);
      expect(approvedMobileSession(selection, [{ ...live, topic: "other" }], "testnet")).toBeNull();
    },
  );
  it("does not restore a guessed Lantern entry before official metadata is registered", () => {
    expect(
      approvedMobileSession({ ...approved, walletId: "lantern" }, [live], "testnet"),
    ).toBeNull();
  });
  it("restores the exact previously approved topic and account", () => {
    expect(approvedMobileSession(approved, [live], "testnet")).toEqual(approved);
  });
  it("does not substitute another session with the same account", () => {
    expect(approvedMobileSession(approved, [{ ...live, topic: "other" }], "testnet")).toBeNull();
  });
  it("rejects expired, disconnected, changed-account, wrong-network and unsupported-method sessions", () => {
    expect(approvedMobileSession(approved, [], "testnet")).toBeNull();
    expect(approvedMobileSession(approved, [{ ...live, expiry: 1 }], "testnet")).toBeNull();
    expect(approvedMobileSession(approved, [live], "mainnet")).toBeNull();
    for (const namespaces of [
      { stellar: { methods: [], accounts: live.namespaces.stellar.accounts } },
      { stellar: { methods: ["stellar_signXDR"], accounts: ["stellar:testnet:another-account"] } },
    ])
      expect(approvedMobileSession(approved, [{ ...live, namespaces }], "testnet")).toBeNull();
  });
  it.each([null, {}, { ...approved, walletId: "other" }, { ...approved, address: 123 }])(
    "ignores malformed saved selection %j",
    (stored) => {
      expect(approvedMobileSession(stored, [live], "testnet")).toBeNull();
    },
  );
});
