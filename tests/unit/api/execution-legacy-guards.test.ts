import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({
  deployment: vi.fn(),
  submit: vi.fn(),
  prepare: vi.fn(),
  record: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mock.deployment } } }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: vi.fn() }));
vi.mock("@/lib/stellar/trigger", () => ({
  submitTriggerTx: mock.submit,
  prepareTriggerTx: mock.prepare,
  prepareWebhookDepositTx: mock.prepare,
}));
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: mock.record }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit, needsSubmitRow: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(),
  requireSession: vi.fn(async () => ({ id: "owner" })),
}));
vi.mock("@/lib/stellar/legacy-submission", () => ({
  registerLegacyPreparation: vi.fn(),
  admitLegacySubmission: mock.record,
}));
import { POST as prepare } from "@/app/api/deployments/[id]/trigger/route";
import { POST as submit } from "@/app/api/deployments/[id]/submit-trigger/route";
import { POST as invoke } from "@/app/api/deployments/[id]/submit-invoke/route";
beforeEach(() => {
  vi.clearAllMocks();
  mock.deployment.mockResolvedValue({
    id: "id",
    status: "CONFIRMED",
    graphSnapshot: { fieldPolicies: { version: 1, nodes: [] } },
  });
});
describe("legacy public surfaces cannot relay policy-v1 execution", () => {
  it.each([
    ["trigger", prepare],
    ["submit-trigger", submit],
    ["submit-invoke", invoke],
  ] as const)("%s refuses before signer/audit/relay writes", async (name, handler) => {
    const body =
      name === "trigger"
        ? { amount: "10", userAddress: Keypair.random().publicKey() }
        : { signedXdr: "unrelated-signed-envelope" };
    const req = new Request(`https://app.test/api/deployments/id/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as NextRequest;
    const result = await handler(req, { params: Promise.resolve({ id: "id" }) });
    expect(result.status).toBe(422);
    expect((await result.json()).error.message).toContain("exact execution preparation");
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.submit).not.toHaveBeenCalled();
    expect(mock.record).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
  });
});
