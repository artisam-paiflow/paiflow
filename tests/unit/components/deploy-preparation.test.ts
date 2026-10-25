import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readDeployPreparation,
  saveDeployPreparation,
  consumeDeployPreparation,
  rejectDeployPreparation,
  clearDeployPreparation,
} from "@/lib/deploy-preparation";
const key = "preparation";
const prepared = {
  deploymentId: "22222222-2222-2222-2222-222222222222",
  txHash: "a".repeat(64),
  address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};
const attempt = {
  txHash: prepared.txHash,
  phase: "signing" as const,
  attemptId: "33333333-3333-3333-3333-333333333333",
};
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
it("stores only public provenance, consumes it before signing and requires matching rejection to restore it", () => {
  saveDeployPreparation(key, { ...prepared, signedXdr: "never persist" } as typeof prepared);
  expect(store.get(key)).not.toContain("never persist");
  consumeDeployPreparation(key, attempt);
  expect(readDeployPreparation(key)).toMatchObject({
    state: "signing",
    attemptId: attempt.attemptId,
  });
  expect(() =>
    consumeDeployPreparation(key, { ...attempt, attemptId: crypto.randomUUID() }),
  ).toThrow();
  rejectDeployPreparation(key, { ...attempt, attemptId: crypto.randomUUID() });
  expect(readDeployPreparation(key)?.state).toBe("signing");
  rejectDeployPreparation(key, attempt);
  expect(readDeployPreparation(key)).toEqual({ ...prepared, state: "ready" });
});
it("never infers safe provenance from absence or overwrites another preparation", () => {
  expect(() => consumeDeployPreparation(key, attempt)).toThrow();
  saveDeployPreparation(key, prepared);
  expect(() => saveDeployPreparation(key, { ...prepared, txHash: "b".repeat(64) })).toThrow();
  clearDeployPreparation(key, { ...prepared, txHash: "b".repeat(64) });
  expect(readDeployPreparation(key)).not.toBeNull();
  clearDeployPreparation(key, prepared);
  expect(readDeployPreparation(key)).toBeNull();
});
it.each([
  "broken",
  "{}",
  JSON.stringify({ ...prepared, state: "signing" }),
  JSON.stringify({ ...prepared, state: "signing", attemptId: "bad" }),
  JSON.stringify({ ...prepared, state: "ready", deploymentId: "../bad" }),
])("preserves invalid provenance for recovery: %s", (raw) => {
  store.set(key, raw);
  expect(() => readDeployPreparation(key)).toThrow();
  expect(store.get(key)).toBe(raw);
});
it("fails closed if consumption cannot be durably written", () => {
  saveDeployPreparation(key, prepared);
  vi.stubGlobal("localStorage", {
    ...localStorage,
    setItem: () => {
      throw new Error("unavailable");
    },
  });
  expect(() => consumeDeployPreparation(key, attempt)).toThrow("unavailable");
});
