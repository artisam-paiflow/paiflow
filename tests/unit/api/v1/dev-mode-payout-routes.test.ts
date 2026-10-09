import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), lease: vi.fn(), submit: vi.fn() }));
// Isolate authorization/transport: test the route's actual feature guard and
// show it runs before parsing, lease access, mutations or transaction submission.
vi.mock("@/lib/api/v1/handler", () => {
  return {
    v1Route:
      (_options: unknown, handler: (context: unknown) => Promise<Response>) =>
      async (req: NextRequest) => {
        const { withErrorHandler } = await import("@/lib/errors");
        return withErrorHandler(() =>
          handler({ req, token: { id: "token" }, params: { id: "deployment" }, deployment: {} }),
        );
      },
  };
});
vi.mock("@/lib/api/v1/payouts", () => ({ preparePayout: mocks.prepare }));
vi.mock("@/lib/api/v1/payout-lease", () => ({
  assertPreparedPayout: mocks.lease,
  releasePreparedPayout: vi.fn(),
}));
vi.mock("@/lib/stellar/submit-deposit", () => ({ submitPreparedDeposit: mocks.submit }));
vi.mock("@/lib/api/v1/execute", () => ({
  resolveExecutablePipeline: () => ({ nodes: [], triggerAddress: "trigger" }),
  assertDepositEnvelope: () => ({ hash: () => Buffer.alloc(32) }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => {
  delete process.env.FEATURE_DEV_MODE_ENABLED;
  vi.resetModules();
});

describe("Dev payout route availability", () => {
  it.each(["prepare", "submit"])(
    "refuses %s before side effects when Dev mode is disabled",
    async (operation) => {
      process.env.FEATURE_DEV_MODE_ENABLED = "false";
      const route =
        operation === "prepare"
          ? await import("@/app/api/v1/deployments/[id]/payouts/route")
          : await import("@/app/api/v1/deployments/[id]/payouts/submit/route");
      const json = vi.fn();
      const response = await route.POST({ json } as unknown as NextRequest, {} as never);
      expect(response.status).toBe(404);
      expect((await response.json()).error.message).toBe("Dev mode is turned off on this server.");
      expect(json).not.toHaveBeenCalled();
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.lease).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );

  it("continues payout preparation with Dev mode enabled", async () => {
    process.env.FEATURE_DEV_MODE_ENABLED = "true";
    mocks.prepare.mockResolvedValue({ xdr: "prepared" });
    const { POST } = await import("@/app/api/v1/deployments/[id]/payouts/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          recipient: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          amount: "1",
        }),
      }) as NextRequest,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });
});
