import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingDeploy,
  deployPendingKey,
  readPendingDeploy,
  savePendingDeploy,
} from "@/lib/deploy-pending";
const deploymentId = "22222222-2222-2222-2222-222222222222";
const txHash = "a".repeat(64);
const saved = { deploymentId, txHash };
const key = deployPendingKey("flow", "testnet");
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
describe("public deployment recovery coordinates", () => {
  it("stores only the public ID/hash and scopes flow/network", () => {
    savePendingDeploy(key, {
      ...saved,
      signedXdr: "never save",
      arbitrary: "never save",
    } as typeof saved);
    expect(store.get(key)).toBe(JSON.stringify(saved));
    expect(readPendingDeploy(key)).toEqual(saved);
    expect(deployPendingKey("flow", "mainnet")).not.toBe(key);
    expect(deployPendingKey("other", "testnet")).not.toBe(key);
  });
  it.each([
    "broken",
    "{}",
    JSON.stringify({ ...saved, deploymentId: "../../bad" }),
    JSON.stringify({ ...saved, txHash: "A".repeat(64) }),
  ])("refuses invalid stored state without deleting it: %s", (raw) => {
    store.set(key, raw);
    expect(() => readPendingDeploy(key)).toThrow();
    expect(store.get(key)).toBe(raw);
  });
  it("never overwrites pending state and clears only the matching ID/hash", () => {
    savePendingDeploy(key, saved);
    expect(() => savePendingDeploy(key, saved)).toThrow();
    clearPendingDeploy(key, { ...saved, txHash: "b".repeat(64) });
    expect(readPendingDeploy(key)).toEqual(saved);
    clearPendingDeploy(key, { ...saved, deploymentId: "33333333-3333-3333-3333-333333333333" });
    expect(readPendingDeploy(key)).toEqual(saved);
    clearPendingDeploy(key, saved);
    expect(readPendingDeploy(key)).toBeNull();
  });
});

describe("deployment signing reservation CAS", () => {
  it("promotes only the matching signing attempt; cancellation never releases submitted or legacy records", async () => {
    const { markPendingDeploySubmitted, rejectPendingDeploySigning } =
      await import("@/lib/deploy-pending");
    const attempt = { ...saved, phase: "signing" as const, attemptId: crypto.randomUUID() };
    savePendingDeploy(key, attempt);
    const stale = { ...attempt, attemptId: crypto.randomUUID() };
    expect(() => markPendingDeploySubmitted(key, stale)).toThrow();
    rejectPendingDeploySigning(key, stale);
    expect(readPendingDeploy(key)).toEqual(attempt);
    markPendingDeploySubmitted(key, attempt);
    rejectPendingDeploySigning(key, attempt);
    expect(readPendingDeploy(key)).toEqual({ ...attempt, phase: "submitted" });
    clearPendingDeploy(key, saved);
    savePendingDeploy(key, saved);
    rejectPendingDeploySigning(key, attempt);
    expect(readPendingDeploy(key)).toEqual(saved);
  });
});
