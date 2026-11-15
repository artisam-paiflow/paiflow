import { beforeEach, expect, it } from "vitest";
import {
  beginConditionalDeployPreparation,
  completeConditionalDeployPreparation,
  readConditionalDeployPreparation,
  readReadyDeployPreparation,
  readDeployPreparation,
  consumeDeployPreparation,
  rejectDeployPreparation,
  saveDeployPreparation,
} from "@/lib/deploy-preparation";
const key = "conditional-preparation-test";
const request = {
  version: 2 as const,
  flowId: "11111111-1111-4111-8111-111111111111",
  sourceAccount: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  preparationKey: "22222222-2222-4222-8222-222222222222",
};
const identity = {
  deploymentId: "33333333-3333-4333-8333-333333333333",
  txHash: "a".repeat(64),
  address: request.sourceAccount,
};
beforeEach(() => localStorage.clear());
it("preparing request has no signable hash and cannot be replaced by another generation", () => {
  beginConditionalDeployPreparation(key, request, "testnet");
  expect(readReadyDeployPreparation(key)).toBeNull();
  expect(() => readDeployPreparation(key)).toThrow();
  expect(() => saveDeployPreparation(key, identity)).toThrow();
  expect(() =>
    beginConditionalDeployPreparation(
      key,
      { ...request, preparationKey: crypto.randomUUID() },
      "testnet",
    ),
  ).toThrow();
  expect(readConditionalDeployPreparation(key)?.request).toEqual(request);
});
it("ready/signing/explicit rejection preserve exact original request and key", () => {
  beginConditionalDeployPreparation(key, request, "testnet");
  const preparing = readConditionalDeployPreparation(key)!;
  completeConditionalDeployPreparation(key, preparing, identity);
  const attempt = {
    phase: "signing" as const,
    txHash: identity.txHash,
    attemptId: crypto.randomUUID(),
  };
  consumeDeployPreparation(key, attempt);
  expect(readReadyDeployPreparation(key)).toMatchObject({
    ...identity,
    state: "signing",
    attemptId: attempt.attemptId,
  });
  rejectDeployPreparation(key, { ...attempt, attemptId: crypto.randomUUID() });
  expect(readConditionalDeployPreparation(key)?.state).toBe("signing");
  rejectDeployPreparation(key, attempt);
  expect(readConditionalDeployPreparation(key)).toMatchObject({
    version: 2,
    state: "ready",
    request,
    network: "testnet",
    ...identity,
  });
});
it.each([
  { version: 3, state: "ready", ...identity },
  { version: 2, state: "preparing", request, network: "testnet", txHash: identity.txHash },
  {
    version: 2,
    state: "ready",
    request: { ...request, sourceAccount: "invalid" },
    network: "testnet",
    ...identity,
  },
])("unknown or mixed retained record remains blocked without clearing", (record) => {
  const raw = JSON.stringify(record);
  localStorage.setItem(key, raw);
  expect(() => readReadyDeployPreparation(key)).toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
});
it("cannot promote a substituted request/source after response loss", () => {
  beginConditionalDeployPreparation(key, request, "testnet");
  const actual = readConditionalDeployPreparation(key)!;
  expect(() =>
    completeConditionalDeployPreparation(
      key,
      { ...actual, request: { ...request, preparationKey: crypto.randomUUID() } },
      identity,
    ),
  ).toThrow();
  expect(readConditionalDeployPreparation(key)?.state).toBe("preparing");
});
it("retained v1 ready identity blocks a new v2 preparing key in the same namespace", () => {
  saveDeployPreparation(key, identity);
  const raw = localStorage.getItem(key);
  expect(() => beginConditionalDeployPreparation(key, request, "testnet")).toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
  expect(readReadyDeployPreparation(key)).toEqual({ ...identity, state: "ready" });
});
