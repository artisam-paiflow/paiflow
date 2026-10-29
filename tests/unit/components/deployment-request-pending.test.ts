import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertNoPendingDeploymentRequest,
  clearPendingDeploymentRequest,
  deploymentRequestPendingKey,
  readPendingDeploymentRequest,
  savePendingDeploymentRequest,
  type PendingDeploymentRequest,
} from "@/lib/deployment-request-pending";
const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const HASH = "a".repeat(64);
const KEY = deploymentRequestPendingKey("deployment", "testnet");
const request: PendingDeploymentRequest = { requestId: ID, phase: "prepare" };
const hashes: PendingDeploymentRequest = {
  requestId: ID,
  phase: "transactions",
  txHashes: [HASH, "b".repeat(64)],
};
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
});
describe("deployment request recovery", () => {
  it("shares legacy reservations with generic signing without migrating or deleting them", () => {
    expect(deploymentRequestPendingKey("deployment", "testnet")).toBe(KEY);
    savePendingDeploymentRequest(KEY, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(request);
    expect(() => assertNoPendingDeploymentRequest("deployment", "testnet")).toThrow(/unresolved/);
    expect(() => assertNoPendingDeploymentRequest("another", "testnet")).not.toThrow();
    savePendingDeploymentRequest(KEY, hashes, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(hashes);
    clearPendingDeploymentRequest(KEY, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(hashes);
    clearPendingDeploymentRequest(KEY, hashes);
    expect(readPendingDeploymentRequest(KEY)).toBeNull();
  });
  it("allowlists public state, scopes networks, and blocks competing admissions", () => {
    savePendingDeploymentRequest(KEY, {
      ...request,
      roster: "private",
    } as PendingDeploymentRequest);
    expect(storage.get(KEY)).toBe(JSON.stringify(request));
    expect(() => assertNoPendingDeploymentRequest("deployment", "testnet")).toThrow(/unresolved/);
    expect(() => assertNoPendingDeploymentRequest("deployment", "mainnet")).not.toThrow();
    expect(() => savePendingDeploymentRequest(KEY, hashes)).toThrow();
    savePendingDeploymentRequest(KEY, hashes, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(hashes);
    expect(() =>
      savePendingDeploymentRequest(KEY, { ...hashes, txHashes: ["c".repeat(64)] }, hashes),
    ).toThrow(/only once/);
    clearPendingDeploymentRequest(KEY, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(hashes);
    clearPendingDeploymentRequest(KEY, hashes);
    expect(readPendingDeploymentRequest(KEY)).toBeNull();
  });
  it("cannot advance or clear a replaced request", () => {
    savePendingDeploymentRequest(KEY, request);
    const other = { requestId: OTHER, phase: "prepare" } as const;
    expect(() => savePendingDeploymentRequest(KEY, hashes, other)).toThrow();
    clearPendingDeploymentRequest(KEY, other);
    expect(readPendingDeploymentRequest(KEY)).toEqual(request);
  });
  it.each([
    "bad",
    "{}",
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [] }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH, HASH] }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: ["invalid"] }),
  ])("retains invalid state and fails closed: %s", (raw) => {
    storage.set(KEY, raw);
    expect(() => assertNoPendingDeploymentRequest("deployment", "testnet")).toThrow();
    expect(storage.get(KEY)).toBe(raw);
  });
  it("rejects failed persistence before a request can be sent", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    expect(() => savePendingDeploymentRequest(KEY, request)).toThrow(/could not be saved/);
  });
});
