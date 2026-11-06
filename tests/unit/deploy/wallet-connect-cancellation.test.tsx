import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";

const mocks = vi.hoisted(() => ({ kit: vi.fn(), warning: vi.fn(), poll: vi.fn(), track: vi.fn() }));
vi.mock("@/components/deploy/wallet-kit", () => ({
  getWalletKit: mocks.kit,
  getCachedWalletKit: () => undefined,
}));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("@/lib/analytics/client", () => ({ track: mocks.track }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { warning: mocks.warning, success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("navigator", {
    userAgent: "test",
    locks: {
      request: async (_key: string, _options: unknown, run: (lock: object) => Promise<void>) =>
        run({}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop trigger QR cancellation", () => {
  it("clears PROCESSING on close, permits reconnect, and never prepares from a late approval", async () => {
    const listeners = new Set<(state: { open: boolean }) => void>();
    const emit = (open: boolean) => {
      for (const listener of listeners) listener({ open });
    };
    const approvals: Array<(session: { topic: string }) => void> = [];
    const client = {
      session: { values: [] },
      connect: vi.fn(async () => ({
        uri: "wc:fixture",
        approval: () => new Promise<{ topic: string }>((resolve) => approvals.push(resolve)),
      })),
      disconnect: vi.fn(async () => {}),
      request: vi.fn(),
    };
    mocks.kit.mockResolvedValue({
      kit: {
        openModal: async (options: {
          onWalletSelected: (wallet: { id: string; name: string }) => void;
        }) => options.onWalletSelected({ id: "wallet_connect", name: "WalletConnect" }),
        setWallet: vi.fn(),
      },
      client,
      module: {},
      modal: {
        subscribeModal: (listener: (state: { open: boolean }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        openModal: async () => emit(true),
        closeModal: () => emit(false),
      },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const view = render(<TriggerButton deploymentId="fixture" network="testnet" amount="10" />);
    const connectButton = () =>
      screen.getByRole("button", { name: /connect wallet & trigger/i }) as HTMLButtonElement;
    await waitFor(() => expect(connectButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(connectButton());
    });
    await waitFor(() => expect(client.connect).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: /processing/i }).getAttribute("disabled"),
    ).not.toBeNull();
    await act(async () => emit(false));
    await waitFor(() => expect(connectButton().disabled).toBe(false));
    expect(mocks.warning).toHaveBeenCalledWith("Connection cancelled");
    await act(async () => {
      fireEvent.click(connectButton());
    });
    await waitFor(() => expect(client.connect).toHaveBeenCalledTimes(2));
    await act(async () => {
      approvals[0]!({ topic: "cancelled-topic" });
    });
    expect(
      screen.getByRole("button", { name: /processing/i }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
    await act(async () => emit(false));
    await waitFor(() => expect(connectButton().disabled).toBe(false));
    expect(mocks.poll).not.toHaveBeenCalled();
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
