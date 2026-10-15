import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertNoPendingPayroll,
  clearPendingPayroll,
  payrollPendingKey,
  readPendingPayroll,
  savePendingPayroll,
  type PendingPayroll,
} from "@/lib/payroll-pending";
import {
  assertNoPendingDeploymentRequest,
  clearPendingDeploymentRequest,
  deploymentRequestPendingKey,
  readPendingDeploymentRequest,
  savePendingDeploymentRequest,
} from "@/lib/deployment-request-pending";
const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const HASH = "a".repeat(64);
const KEY = payrollPendingKey("deployment", "testnet");
const request: PendingPayroll = { requestId: ID, phase: "prepare" };
const hashes: PendingPayroll = {
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
describe("payroll request recovery", () => {
  it("shares legacy reservations with generic signing without migrating or deleting them", () => {
    expect(deploymentRequestPendingKey("deployment", "testnet")).toBe(KEY);
    savePendingPayroll(KEY, request);
    expect(readPendingDeploymentRequest(KEY)).toEqual(request);
    expect(() => assertNoPendingDeploymentRequest("deployment", "testnet")).toThrow(/unresolved/);
    expect(() => assertNoPendingDeploymentRequest("another", "testnet")).not.toThrow();
    savePendingDeploymentRequest(KEY, hashes, request);
    expect(readPendingPayroll(KEY)).toEqual(hashes);
    clearPendingDeploymentRequest(KEY, request);
    expect(readPendingPayroll(KEY)).toEqual(hashes);
    clearPendingPayroll(KEY, hashes);
    expect(readPendingDeploymentRequest(KEY)).toBeNull();
  });
  it("allowlists public state, scopes networks, and blocks competing admissions", () => {
    savePendingPayroll(KEY, { ...request, roster: "private" } as PendingPayroll);
    expect(storage.get(KEY)).toBe(JSON.stringify(request));
    expect(() => assertNoPendingPayroll("deployment", "testnet")).toThrow(/unresolved/);
    expect(() => assertNoPendingPayroll("deployment", "mainnet")).not.toThrow();
    expect(() => savePendingPayroll(KEY, hashes)).toThrow();
    savePendingPayroll(KEY, hashes, request);
    expect(readPendingPayroll(KEY)).toEqual(hashes);
    expect(() =>
      savePendingPayroll(KEY, { ...hashes, txHashes: ["c".repeat(64)] }, hashes),
    ).toThrow(/only once/);
    clearPendingPayroll(KEY, request);
    expect(readPendingPayroll(KEY)).toEqual(hashes);
    clearPendingPayroll(KEY, hashes);
    expect(readPendingPayroll(KEY)).toBeNull();
  });
  it("cannot advance or clear a replaced request", () => {
    savePendingPayroll(KEY, request);
    const other = { requestId: OTHER, phase: "prepare" } as const;
    expect(() => savePendingPayroll(KEY, hashes, other)).toThrow();
    clearPendingPayroll(KEY, other);
    expect(readPendingPayroll(KEY)).toEqual(request);
  });
  it.each([
    "bad",
    "{}",
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [] }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH, HASH] }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: ["invalid"] }),
  ])("retains invalid state and fails closed: %s", (raw) => {
    storage.set(KEY, raw);
    expect(() => assertNoPendingPayroll("deployment", "testnet")).toThrow();
    expect(storage.get(KEY)).toBe(raw);
  });
  it("rejects failed persistence before a request can be sent", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    expect(() => savePendingPayroll(KEY, request)).toThrow(/could not be saved/);
  });
});
