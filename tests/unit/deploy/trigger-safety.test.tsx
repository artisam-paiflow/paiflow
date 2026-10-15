import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
import { contractCallPendingKey } from "@/lib/contract-call-pending";
const mocks = vi.hoisted(() => ({
  kit: vi.fn(),
  connect: vi.fn(),
  sign: vi.fn(),
  hash: vi.fn(),
  assertNetwork: vi.fn(),
  poll: vi.fn(),
  fetch: vi.fn(),
  track: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({
  getWalletKit: mocks.kit,
  getCachedWalletKit: () => undefined,
}));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: mocks.connect,
}));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("@/lib/stellar/wallet-signature", () => ({
  signedWalletTransactionHash: mocks.hash,
  assertWalletNetwork: mocks.assertNetwork,
}));
vi.mock("@/lib/analytics/client", () => ({ track: mocks.track }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: mocks.error }));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: mocks.success },
}));
const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const TESTNET = "Test SDF Network ; September 2015";
const key = contractCallPendingKey("deployment", "testnet");
const allowanceKey = "paiflow_allowance_pending:deployment:testnet";
const base = { deploymentId: "deployment", network: "testnet" as const, amount: "1000000" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function button() {
  return screen.getByRole("button", {
    name: /connect wallet & (trigger|approve)/i,
  }) as HTMLButtonElement;
}
async function click() {
  await act(async () => {
    fireEvent.click(button());
  });
}
async function mount(props = {}) {
  const view = render(<TriggerButton {...base} {...props} />);
  await waitFor(() => expect(button().disabled).toBe(false));
  return view;
}
function prepared() {
  return {
    ok: true,
    json: async () => ({
      data: {
        xdr: "unsigned",
        networkPassphrase: TESTNET,
        txHash: hash,
        intent: "existing-private-intent",
      },
    }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("navigator", {
    userAgent: "test",
    locks: {
      request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
        callback({}),
    },
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.kit.mockResolvedValue({});
  mocks.connect.mockResolvedValue({ address, walletId: "freighter", signTransaction: mocks.sign });
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.hash.mockReturnValue(hash);
  mocks.poll.mockResolvedValue({ status: "SUCCESS" });
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("submit-trigger") || url.endsWith("submit-invoke") || url.endsWith("/submit")
      ? { ok: true, json: async () => ({ data: { txHash: otherHash } }) }
      : prepared(),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trigger dispatch admission and read-only recovery", () => {
  it("rejects a mismatched server network before asking the wallet to sign", async () => {
    mocks.assertNetwork.mockImplementation(() => {
      throw new Error("Network mismatch");
    });
    await mount();
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("validates every wallet response and persists only its computed hash before a single dispatch", async () => {
    const pendingAtDispatch: Array<string | null> = [];
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("submit-trigger")) {
        pendingAtDispatch.push(localStorage.getItem(key));
        return { ok: true, json: async () => ({ data: { txHash: otherHash } }) };
      }
      return prepared();
    });
    await mount();
    await click();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    // Assert outside the submit mock: production deliberately catches transport
    // rejections, which would otherwise swallow a failed assertion in that mock.
    expect(pendingAtDispatch).toEqual([JSON.stringify({ txHash: hash })]);
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(
      "testnet",
      "unsigned",
      "signed",
      address,
      TESTNET,
    );
    expect(mocks.fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/deployments/deployment/trigger",
      "/api/deployments/deployment/submit-trigger",
    ]);
    expect(mocks.poll).toHaveBeenCalledWith("deployment", hash);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it.each(["PENDING", "NOT_FOUND"])(
    "retains %s as unknown without allowing another payment",
    async (status) => {
      mocks.poll.mockResolvedValue({ status });
      await mount();
      await click();
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("still unknown"),
      );
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ txHash: hash });
      expect(button().disabled).toBe(true);
      expect(
        JSON.stringify(
          [...Array(localStorage.length)].map((_, index) =>
            localStorage.getItem(localStorage.key(index)!),
          ),
        ),
      ).not.toMatch(/signed|unsigned/);
    },
  );
  it("recovers an existing hash without wallet, preparation or resubmission", async () => {
    localStorage.setItem(key, JSON.stringify({ txHash: hash }));
    render(<TriggerButton {...base} />);
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith("deployment", hash));
    expect(mocks.kit).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  });
  it("manual checking after unknown finality never prepares or signs again", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("timeout"));
    await mount();
    await click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "CHECK TRANSACTION STATUS" }));
    });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("releases a failed transaction only after authoritative FAILED and reports its on-chain stage", async () => {
    mocks.poll.mockResolvedValue({ status: "FAILED", errorMessage: "Contract refused" });
    await mount();
    await click();
    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith(
        "trigger_failed",
        expect.objectContaining({ stage: "onchain", tx_hash: hash }),
      ),
    );
    expect(localStorage.getItem(key)).toBeNull();
    expect(button().disabled).toBe(false);
  });
  it("cannot submit a signed response that fails cryptographic/body binding", async () => {
    mocks.hash.mockImplementation(() => {
      throw new Error("Wallet changed transaction");
    });
    await mount();
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("fails closed if the public hash cannot be durably saved", async () => {
    await mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await click();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("No transaction was submitted"),
    );
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(button().disabled).toBe(true);
  });
  it("does not open a wallet without origin-wide transaction coordination", async () => {
    vi.stubGlobal("navigator", { userAgent: "test" });
    await mount();
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.kit).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("checks legacy allowance state before permitting ordinary payments", async () => {
    localStorage.setItem(
      allowanceKey,
      JSON.stringify({ txHash: otherHash, intent: "private-existing-intent" }),
    );
    render(<TriggerButton {...base} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("allowance page"));
    expect(button().disabled).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
  });
});

describe("trigger attempt lifetime", () => {
  it.each(["amount", "network", "deployment", "mode", "disabled", "unmount"])(
    "refuses a late signature after %s changes",
    async (change) => {
      const signing = deferred<{ signedTxXdr: string }>();
      mocks.sign.mockReturnValue(signing.promise);
      const view = await mount();
      await click();
      await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
      await act(async () => {
        if (change === "unmount") view.unmount();
        else
          view.rerender(
            <TriggerButton
              {...base}
              {...(change === "amount"
                ? { amount: "2000000" }
                : change === "network"
                  ? { network: "mainnet" }
                  : change === "deployment"
                    ? { deploymentId: "other" }
                    : change === "mode"
                      ? { mode: "allowance" }
                      : { disabled: true })}
            />,
          );
      });
      await act(async () => signing.resolve({ signedTxXdr: "signed" }));
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.poll).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
      expect(localStorage.getItem(key)).toBeNull();
    },
  );
  it("ignores an old preparation response and releases its pre-dispatch lock", async () => {
    const preparing = deferred<ReturnType<typeof prepared>>();
    mocks.fetch.mockReturnValueOnce(preparing.promise);
    const view = await mount();
    await click();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await act(async () => view.rerender(<TriggerButton {...base} amount="2000000" />));
    await click();
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    await act(async () => preparing.resolve(prepared()));
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("a pending HTTP response cannot hide dispatch or permit a replacement after argument edits", async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const finality = deferred<{ status: string }>();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("submit-trigger") ? response.promise : prepared(),
    );
    mocks.poll.mockReturnValue(finality.promise);
    const view = await mount();
    await click();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith("deployment", hash));
    await act(async () => view.rerender(<TriggerButton {...base} amount="2000000" />));
    expect(button().disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ txHash: hash });
    await act(async () =>
      response.resolve({ ok: true, json: async () => ({ data: { txHash: otherHash } }) }),
    );
    expect(mocks.poll).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.success).not.toHaveBeenCalledWith("Distribution triggered!");
  });
  it("keeps dispatched reconciliation alive across unmount/remount and never replays the write", async () => {
    const finality = deferred<{ status: string }>();
    mocks.poll.mockReturnValue(finality.promise);
    const view = await mount();
    await click();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce());
    view.unmount();
    render(<TriggerButton {...base} />);
    await act(async () => {});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(button().disabled).toBe(true);
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.sign).toHaveBeenCalledOnce();
  });
  it("rejects duplicate clicks synchronously before busy state rerenders", async () => {
    const signing = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValue(signing.promise);
    await mount();
    await act(async () => {
      fireEvent.click(button());
      fireEvent.click(button());
    });
    expect(mocks.connect).toHaveBeenCalledOnce();
    await act(async () => signing.resolve({ signedTxXdr: "signed" }));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("public allowance keeps its established scoped protocol", () => {
  it("preserves immediate definitive refusal and stores no second opaque intent", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/submit")
        ? {
            ok: false,
            status: 403,
            json: async () => ({ error: { message: "Subscriber changed" } }),
          }
        : prepared(),
    );
    await mount({ mode: "allowance", templateKind: "SUBSCRIPTION" });
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(localStorage.getItem(allowanceKey)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.poll).not.toHaveBeenCalled();
  });
  it("uses the saved intent for status while preserving unknown finality", async () => {
    mocks.poll.mockRejectedValue(new Error("timeout"));
    await mount({ mode: "allowance", templateKind: "SUBSCRIPTION" });
    await click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(JSON.parse(localStorage.getItem(allowanceKey)!)).toEqual({
      txHash: hash,
      intent: "existing-private-intent",
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment",
      hash,
      undefined,
      "/api/deployments/deployment/subscription-allowance/status?intent=existing-private-intent",
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toMatch(/private-intent|signed|unsigned/);
  });
  it("starts intent-specific recovery when a submit response hangs and keeps its sole marker", async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/submit") ? response.promise : prepared(),
    );
    mocks.poll.mockRejectedValue(new Error("timeout"));
    await mount({ mode: "allowance", templateKind: "SUBSCRIPTION" });
    vi.useFakeTimers();
    await click();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(allowanceKey)!)).toEqual({
      txHash: hash,
      intent: "existing-private-intent",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.poll).toHaveBeenCalledWith(
      "deployment",
      hash,
      undefined,
      expect.stringContaining("subscription-allowance/status?intent="),
    );
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(allowanceKey)).not.toBeNull();
    expect(button().disabled).toBe(true);
  });
  it("honors a late definite pre-send refusal without abandoning the established status proof", async () => {
    const response = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
    const finality = deferred<{ status: string }>();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/submit") ? response.promise : prepared(),
    );
    mocks.poll.mockReturnValue(finality.promise);
    await mount({ mode: "allowance", templateKind: "SUBSCRIPTION" });
    vi.useFakeTimers();
    await click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.poll).toHaveBeenCalledOnce();
    await act(async () =>
      response.resolve({
        ok: false,
        status: 409,
        json: async () => ({ error: { message: "Approval refused" } }),
      }),
    );
    expect(localStorage.getItem(allowanceKey)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.error).toHaveBeenCalled();
    // The eventual old status completion cannot delete a different pending hash.
    localStorage.setItem(
      allowanceKey,
      JSON.stringify({ txHash: otherHash, intent: "different-intent" }),
    );
    await act(async () => finality.resolve({ status: "FAILED" }));
    expect(JSON.parse(localStorage.getItem(allowanceKey)!).txHash).toBe(otherHash);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
