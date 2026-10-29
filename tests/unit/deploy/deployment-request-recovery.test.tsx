import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
import ContractCallButton from "@/components/deploy/contract-call-button";
import {
  deploymentRequestPendingKey,
  savePendingDeploymentRequest,
} from "@/lib/deployment-request-pending";
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  sign: vi.fn(),
  kit: vi.fn(),
  fetch: vi.fn(),
  poll: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  hash: vi.fn(),
  network: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({
  getWalletKit: mocks.kit,
  getCachedWalletKit: vi.fn(),
}));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: mocks.connect,
  assertWalletAttemptActive: (signal: AbortSignal) => signal.throwIfAborted(),
}));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: mocks.error }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
// Component tests exercise the validation boundary; the node wallet-signature
// suite verifies real bodies, signatures, signer and network cryptographically.
vi.mock("@/lib/stellar/wallet-signature", () => ({
  preparedWalletTransactionHash: () => "b".repeat(64),
  signedWalletTransactionHash: mocks.hash,
  assertWalletNetwork: mocks.network,
}));
const HASH = "b".repeat(64);
const OTHER_HASH = "a".repeat(64);
const ID = "11111111-1111-1111-1111-111111111111";
const KEY = deploymentRequestPendingKey(ID, "testnet");
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _opts: unknown, fn: (lock: object) => Promise<void>) => fn({}),
    },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("conservative deployment request recovery", () => {
  it.each([
    "corrupt",
    JSON.stringify({ requestId: ID, phase: "prepare" }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH] }),
  ])(
    "Generic rechecks deployment request admission under its lock even without an event: %s",
    async (raw) => {
      const prepare = vi.fn();
      const submit = vi.fn();
      render(
        <ContractCallButton
          deploymentId={ID}
          network="testnet"
          actionKey="x"
          label="RUN"
          busyLabel="RUNNING"
          prepare={prepare}
          submit={submit}
        />,
      );
      localStorage.setItem(KEY, raw);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /RUN/ })));
      await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
      expect(prepare).not.toHaveBeenCalled();
      expect(mocks.kit).not.toHaveBeenCalled();
      expect(localStorage.getItem(KEY)).toBe(raw);
    },
  );
  it("blocks Generic ContractCall on prepare and hash-list markers, including same-tab notification", async () => {
    const prepare = vi.fn();
    const submit = vi.fn();
    render(
      <ContractCallButton
        deploymentId={ID}
        network="testnet"
        actionKey="x"
        label="RUN"
        busyLabel="RUNNING"
        prepare={prepare}
        submit={submit}
      />,
    );
    await act(async () => savePendingDeploymentRequest(KEY, { requestId: ID, phase: "prepare" }));
    expect((screen.getByRole("button", { name: /RUN/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /RUN/ }));
    expect(prepare).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each([
    "corrupt",
    JSON.stringify({ requestId: ID, phase: "prepare" }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH, OTHER_HASH] }),
  ])(
    "Trigger rechecks deployment request marker under admission without an event: %s",
    async (raw) => {
      render(<TriggerButton deploymentId={ID} network="testnet" amount="1000000" />);
      localStorage.setItem(KEY, raw);
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: /connect wallet & trigger/i })),
      );
      await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
      expect(mocks.kit).not.toHaveBeenCalled();
      expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
      expect(localStorage.getItem(KEY)).toBe(raw);
    },
  );
  it("Trigger observes same-tab deployment request notification and disables new actions", async () => {
    render(<TriggerButton deploymentId={ID} network="testnet" amount="1000000" />);
    await act(async () => savePendingDeploymentRequest(KEY, { requestId: ID, phase: "prepare" }));
    expect(
      (screen.getByRole("button", { name: /connect wallet & trigger/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("deployment request");
    expect(mocks.kit).not.toHaveBeenCalled();
  });
});
