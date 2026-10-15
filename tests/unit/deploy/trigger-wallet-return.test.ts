import { describe, expect, it } from "vitest";
import { pendingWalletReturn } from "@/components/deploy/trigger-wallet-return";
const now = 1800000000000;
const action = JSON.stringify(["deployment-id", "testnet", "1000000", "trigger", null, true]);
const record = {
  boundAction: action,
  network: "testnet",
  timestamp: now,
  walletId: "freighter",
  pairingTopic: "pairing-topic",
};
describe("bound wallet return", () => {
  it("restores only the action that initiated the exact pairing", () => {
    expect(pendingWalletReturn(record, action, "testnet", now)).toEqual(record);
  });
  it.each([
    undefined,
    null,
    {},
    { ...record, boundAction: "other-deployment-or-amount" },
    { ...record, network: "mainnet" },
    { ...record, timestamp: now - 120001 },
    { ...record, timestamp: now + 5001 },
    { ...record, timestamp: "old" },
    { ...record, timestamp: Number.NaN },
    { ...record, walletId: "unverified-wallet" },
    { ...record, pairingTopic: "bad topic" },
    { ...record, pairingTopic: "" },
    // Legacy records are unbound. Refuse automatic preparation, not financial recovery.
    { network: "testnet", timestamp: now, walletId: "freighter", pairingTopic: "pairing-topic" },
  ])("does not resume malformed, stale, legacy or different action %j", (value) => {
    expect(pendingWalletReturn(value, action, "testnet", now)).toBeNull();
  });
});
