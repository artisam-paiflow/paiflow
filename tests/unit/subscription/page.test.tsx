import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ deployment: vi.fn(), state: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.deployment } } }));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => {},
  clientIp: () => "203.0.113.1",
}));
vi.mock("@/lib/subscription/state", () => ({ subscriptionState: mocks.state }));
vi.mock("@/components/deploy/trigger-button", () => ({
  TriggerButton: ({ disabled }: { disabled?: boolean }) => (
    <button disabled={disabled}>CONNECT WALLET & APPROVE</button>
  ),
}));
import AllowancePage from "@/app/allowance/[deploymentId]/page";
const params = Promise.resolve({ deploymentId: "11111111-1111-4111-8111-111111111111" });
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("hosted subscription allowance page", () => {
  it.each([null, "configured-wallet"])(
    "renders current subscriber %s without requiring a Paiflow session",
    async (subscriber) => {
      mocks.deployment.mockResolvedValue({ flow: { templateKind: "SUBSCRIPTION" } });
      mocks.state.mockResolvedValue({
        contractAddress: "current-contract",
        flowName: "Club",
        network: "testnet",
        assetLabel: "XLM",
        subscriber,
        isCancelled: false,
      });
      render(await AllowancePage({ params }));
      expect(mocks.session).not.toHaveBeenCalled();
      expect(screen.getByTestId("network-chip").textContent).toContain("TESTNET");
      if (subscriber)
        expect(screen.getByRole("button", { name: "CONNECT WALLET & APPROVE" })).toBeTruthy();
      else {
        expect(screen.getByText(/configure the subscriber/)).toBeTruthy();
        expect(
          (screen.getByRole("button", { name: "CONNECT WALLET & APPROVE" }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      }
      cleanup();
    },
  );
  it.each([null, { flow: { templateKind: "SPLITTER" } }])(
    "refuses missing, unconfirmed and unsupported deployments without requiring login",
    async (deployment) => {
      mocks.deployment.mockResolvedValue(deployment);
      await expect(AllowancePage({ params })).rejects.toThrow("not-found");
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it("refuses invalid deployment ids before the database lookup", async () => {
    await expect(
      AllowancePage({ params: Promise.resolve({ deploymentId: "invalid-id" }) }),
    ).rejects.toThrow("not-found");
    expect(mocks.deployment).not.toHaveBeenCalled();
  });
  it("keeps payroll behind its existing page-session guard", async () => {
    mocks.deployment.mockResolvedValue({ flow: { templateKind: "PAYROLL" } });
    mocks.session.mockRejectedValue(new Error("redirect-to-login"));
    await expect(AllowancePage({ params })).rejects.toThrow("redirect-to-login");
  });
});
