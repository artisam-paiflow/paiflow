import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEPLOYMENT_ID, ctx, newToken, request, tokenRow } from "./execute-fixtures";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  state: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { deploymentApiToken: { findUnique: mocks.lookup, update: vi.fn() } },
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/v1/conditional-execution-payments", () => ({
  prepareConditionalExecutionPayment: mocks.prepare,
  submitConditionalExecutionPayment: mocks.submit,
}));
vi.mock("@/lib/stellar/conditional-execution-state", () => ({
  readConditionalExecutionState: mocks.state,
}));
import { GET as state } from "@/app/api/v1/deployments/[id]/execution/route";
import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { POST as reconcile } from "@/app/api/v1/deployments/[id]/execute/reconcile/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue(null);
});
describe("explicit v2 execution retains the existing credential boundary", () => {
  for (const [suffix, handler] of [
    ["execution", state],
    ["execute", prepare],
    ["execute/submit", submit],
    ["execute/reconcile", reconcile],
  ] as const)
    it.each([
      "missing",
      "wrong-format",
      "unknown",
      "other-deployment",
      "revoked",
      "inactive-owner",
    ])(`${suffix} rejects %s credentials before versioned payment work`, async (attack) => {
      const token = newToken();
      if (attack === "other-deployment")
        mocks.lookup.mockResolvedValue({
          ...tokenRow(token),
          deploymentId: "22222222-2222-4222-8222-222222222222",
        });
      if (attack === "revoked")
        mocks.lookup.mockResolvedValue({ ...tokenRow(token), revokedAt: new Date() });
      if (attack === "inactive-owner")
        mocks.lookup.mockResolvedValue(tokenRow(token, {}, { isActive: false, role: "USER" }));
      const authorization =
        attack === "missing"
          ? undefined
          : attack === "wrong-format"
            ? "Bearer invalid"
            : `Bearer ${token.plaintext}`;
      const result = await handler(
        request(`/api/v1/deployments/${DEPLOYMENT_ID}/${suffix}?version=2`, {
          authorization,
          body: {},
        }),
        ctx(),
      );
      expect(result.status).toBe(401);
      expect((await result.json()).error.code).toBe("UNAUTHENTICATED");
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.state).not.toHaveBeenCalled();
    });
});
