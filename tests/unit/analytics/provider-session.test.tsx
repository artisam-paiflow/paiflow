import { beforeEach, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
const { sessionState, analytics } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: { id: string; role: string } } | null,
    status: "loading",
  },
  analytics: {
    analyticsEnabled: () => false,
    loadAnalytics: vi.fn(async () => null),
    setAnalyticsContext: vi.fn(),
    setAnalyticsSubject: vi.fn(),
    synchronizeAnalytics: vi.fn(async () => {}),
    trackException: vi.fn(),
    setPersonProps: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/trigger/test" }));
vi.mock("next-auth/react", () => ({ useSession: () => sessionState }));
vi.mock("@/lib/analytics/client", () => analytics);
let AnalyticsProvider: typeof import("@/components/app/analytics-provider").AnalyticsProvider;
let wallets: typeof import("@/lib/wallet-tracking");
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionState.status = "loading";
  sessionState.data = null;
  wallets = await import("@/lib/wallet-tracking");
  AnalyticsProvider = (await import("@/components/app/analytics-provider")).AnalyticsProvider;
});
it.each(["00000000-0000-0000-0000-000000000001", null])(
  "delivers an early wallet connection after NextAuth resolves to %s",
  async (userId) => {
    const delivery = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === "/api/audit/analytics-context")
          return new Response(JSON.stringify({ data: { subject_id: userId } }));
        const body = JSON.parse(String(options?.body));
        delivery(body);
        if (body.sessionUserId !== userId) return new Response("{}", { status: 409 });
        return new Response(
          JSON.stringify({ data: { ok: true, connectionId: body.connectionId } }),
        );
      }),
    );
    try {
      const view = render(<AnalyticsProvider />);
      await wallets.trackWalletConnection({
        address: `G${"B".repeat(55)}`,
        network: "testnet",
        walletId: "freighter",
        surface: "trigger",
      });
      expect(delivery).not.toHaveBeenCalled();
      expect(analytics.setAnalyticsSubject).toHaveBeenLastCalledWith(undefined);
      sessionState.status = userId ? "authenticated" : "unauthenticated";
      sessionState.data = userId ? { user: { id: userId, role: "USER" } } : null;
      view.rerender(<AnalyticsProvider />);
      await waitFor(() => expect(delivery).toHaveBeenCalledTimes(1));
      expect(delivery.mock.calls[0]?.[0]).toMatchObject({ sessionUserId: userId });
      await waitFor(() =>
        expect(JSON.parse(sessionStorage.getItem("paiflow-wallet-delivery-v2") ?? "[]")).toEqual(
          [],
        ),
      );
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
