import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowancePendingKey,
  readAllowancePendingHash,
} from "@/lib/subscription/allowance-pending";
const store = new Map<string, string>();
const key = allowancePendingKey("deployment", "testnet");
const hash = "a".repeat(64);
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null });
});
afterEach(() => vi.unstubAllGlobals());
describe("read-only allowance cross-surface guard", () => {
  it("returns only the hash without copying, changing or returning the existing intent", () => {
    const raw = JSON.stringify({ txHash: hash, intent: "private-existing-intent" });
    store.set(key, raw);
    expect(readAllowancePendingHash("deployment", "testnet")).toBe(hash);
    expect(store.get(key)).toBe(raw);
    expect(readAllowancePendingHash("other-deployment", "testnet")).toBeNull();
    expect(readAllowancePendingHash("deployment", "mainnet")).toBeNull();
  });
  it.each([
    "bad-json",
    "null",
    "{}",
    JSON.stringify({ txHash: hash }),
    JSON.stringify({ txHash: hash, intent: "" }),
    JSON.stringify({ txHash: "bad", intent: "private" }),
  ])("fails closed on corrupt pending state %s", (raw) => {
    store.set(key, raw);
    expect(() => readAllowancePendingHash("deployment", "testnet")).toThrow();
    expect(store.get(key)).toBe(raw);
  });
  it("fails closed when storage is inaccessible", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => readAllowancePendingHash("deployment", "testnet")).toThrow();
  });
});
