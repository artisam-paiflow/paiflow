import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerButton } from "@/components/deploy/trigger-button";
import { allowancePendingKey } from "@/lib/subscription/allowance-pending";
import EmployeeManager from "@/components/payroll/employee-manager";
import ContractCallButton from "@/components/deploy/contract-call-button";
import { payrollPendingKey, savePendingPayroll } from "@/lib/payroll-pending";
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
  signedWalletTransactionHash: mocks.hash,
  assertWalletNetwork: mocks.network,
}));
const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const recipient = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";
const unsigned = "prepared-envelope";
const signed = "signed-envelope";
const HASH = "b".repeat(64);
const Networks = {
  TESTNET: "Test SDF Network ; September 2015",
  PUBLIC: "Public Global Stellar Network ; September 2015",
};
const OTHER_HASH = "a".repeat(64);
const ID = "11111111-1111-1111-1111-111111111111";
const KEY = payrollPendingKey(ID, "testnet");
const props = {
  deploymentId: ID,
  network: "testnet" as const,
  asset: { kind: "native" } as const,
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => ({ data }) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let prepared: unknown;
async function load() {
  return render(<EmployeeManager {...props} />);
}
async function save() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "SAVE EMPLOYEES" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "SAVE EMPLOYEES" }));
  });
}
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
  prepared = { unsignedXdr: unsigned, networkPassphrase: Networks.TESTNET };
  mocks.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
    if (url.endsWith("/payroll-recipients"))
      return response({
        recipients: [{ address: recipient, amount: "1000000", label: "Employee" }],
      });
    if (url.endsWith("/employees/bank")) return response([]);
    if (url.endsWith("/payroll-update-recipients") && opts?.method === "POST")
      return response(prepared);
    throw new Error("Submit response lost");
  });
  mocks.kit.mockResolvedValue({});
  mocks.hash.mockReturnValue(HASH);
  mocks.network.mockImplementation((network: string, passphrase: string) => {
    if (network !== "testnet" || passphrase !== Networks.TESTNET)
      throw new Error("Network mismatch");
  });
  mocks.sign.mockResolvedValue({ signedTxXdr: signed });
  mocks.connect.mockResolvedValue({
    address: address,
    walletId: "freighter",
    signTransaction: mocks.sign,
  });
  mocks.poll.mockRejectedValue(new Error("Finality unknown"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("payroll conservative request recovery", () => {
  it("records prepare before a potentially writing request and never repeats a lost response", async () => {
    const snapshots: (string | null)[] = [];
    const usual = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url.endsWith("/payroll-update-recipients")) {
        snapshots.push(localStorage.getItem(KEY));
        throw new Error("response lost");
      }
      return usual(url, opts);
    });
    await load();
    await save();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("no transaction hashes"),
    );
    expect(JSON.parse(snapshots[0]!).phase).toBe("prepare");
    expect(JSON.parse(snapshots[0]!)).toEqual({ requestId: expect.any(String), phase: "prepare" });
    expect(
      (screen.getByRole("button", { name: "SAVE EMPLOYEES" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(
      mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/payroll-update-recipients")),
    ).toHaveLength(1);
  });
  it("binds desktop signatures and persists the verified hash before submit", async () => {
    let atSubmit: string | null = null;
    const usual = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url.endsWith("/submit-invoke")) {
        atSubmit = localStorage.getItem(KEY);
        throw new Error("lost");
      }
      return usual(url, opts);
    });
    await load();
    await save();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith(ID, HASH));
    expect(JSON.parse(atSubmit!)).toEqual({
      requestId: expect.any(String),
      phase: "transactions",
      txHashes: [HASH],
    });
    expect(mocks.hash).toHaveBeenCalledWith("testnet", unsigned, signed, address, Networks.TESTNET);
    expect(mocks.sign).toHaveBeenCalledWith(unsigned, {
      address: address,
      networkPassphrase: Networks.TESTNET,
    });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(atSubmit);
  });
  it("rejects a changed desktop envelope before bytes are sent", async () => {
    mocks.hash.mockImplementation(() => {
      throw new Error("Wallet changed the transaction body");
    });
    await load();
    await save();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/submit-invoke"))).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it("does not sign on server network mismatch", async () => {
    prepared = { unsignedXdr: unsigned, networkPassphrase: Networks.PUBLIC };
    await load();
    await save();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("input changes invalidate a late wallet approval without submitting captured old roster", async () => {
    const approval = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValue(approval.promise);
    await load();
    await save();
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "2" } });
    await act(async () => approval.resolve({ signedTxXdr: signed }));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/submit-invoke"))).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect((screen.getByPlaceholderText("Amount") as HTMLInputElement).value).toBe("2");
  });
  it("retains returned relayer hashes after view changes and waits for every terminal outcome", async () => {
    const request = deferred<ReturnType<typeof response>>();
    const finality = deferred<{ status: "SUCCESS" }>();
    const usual = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, opts?: { method?: string }) =>
      url.endsWith("/payroll-update-recipients") ? request.promise : usual(url, opts),
    );
    mocks.poll.mockImplementation((_id: string, hash: string) =>
      hash === HASH ? Promise.resolve({ status: "FAILED" }) : finality.promise,
    );
    const view = await load();
    await save();
    view.rerender(
      <EmployeeManager {...props} deploymentId="22222222-2222-2222-2222-222222222222" />,
    );
    await act(async () => request.resolve(response({ txHashes: [HASH, OTHER_HASH] })));
    expect(JSON.parse(localStorage.getItem(KEY)!).txHashes).toEqual([HASH, OTHER_HASH]);
    expect(mocks.poll).toHaveBeenCalledWith(ID, HASH);
    expect(mocks.poll).toHaveBeenCalledWith(ID, OTHER_HASH);
    await act(async () => finality.resolve({ status: "SUCCESS" }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it("does not claim completion for pending hashes, and recovers only by status after remount", async () => {
    prepared = { txHashes: [HASH, OTHER_HASH] };
    mocks.poll.mockImplementation((_id: string, hash: string) =>
      hash === HASH ? Promise.resolve({ status: "SUCCESS" }) : Promise.reject(new Error("unknown")),
    );
    const view = await load();
    await save();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    view.unmount();
    const writes = mocks.fetch.mock.calls.filter(([, opts]) => opts?.method === "POST").length;
    await load();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(4));
    expect(mocks.fetch.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(
      writes,
    );
    expect(mocks.success).not.toHaveBeenCalled();
    mocks.poll.mockResolvedValue({ status: "FAILED" });
    fireEvent.click(screen.getByRole("button", { name: "CHECK PAYROLL STATUS" }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("partially completed");
  });
  it.each([{}, { txHashes: [] }, { txHashes: ["bad"] }])(
    "retains no-hash uncertainty for invalid responses %s",
    async (value) => {
      prepared = value;
      await load();
      await save();
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("no transaction hashes"),
      );
      expect(JSON.parse(localStorage.getItem(KEY)!).phase).toBe("prepare");
    },
  );
  it("does not send prepare without browser admission or durable storage", async () => {
    vi.stubGlobal("navigator", {});
    await load();
    await save();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  });
  it("does not dispatch prepare if marker persistence fails", async () => {
    await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await save();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  });
  it.each([
    "corrupt",
    JSON.stringify({ requestId: ID, phase: "prepare" }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH] }),
  ])("Generic rechecks payroll admission under its lock even without an event: %s", async (raw) => {
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
  });
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
    await act(async () => savePendingPayroll(KEY, { requestId: ID, phase: "prepare" }));
    expect((screen.getByRole("button", { name: /RUN/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /RUN/ }));
    expect(prepare).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each(["corrupt", JSON.stringify({ txHash: HASH, intent: "opaque-test-intent" })])(
    "payroll rechecks unresolved legacy allowance under admission without an event: %s",
    async (raw) => {
      await load();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "SAVE EMPLOYEES" })).toBeDefined(),
      );
      localStorage.setItem(allowancePendingKey(ID, "testnet"), raw);
      await save();
      await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
      expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
      expect(localStorage.getItem(allowancePendingKey(ID, "testnet"))).toBe(raw);
    },
  );
  it("payroll disables updating for a restored allowance marker", async () => {
    localStorage.setItem(
      allowancePendingKey(ID, "testnet"),
      JSON.stringify({ txHash: HASH, intent: "opaque-test-intent" }),
    );
    await load();
    const button = await screen.findByRole("button", { name: "SAVE EMPLOYEES" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  });
  it.each([
    "corrupt",
    JSON.stringify({ requestId: ID, phase: "prepare" }),
    JSON.stringify({ requestId: ID, phase: "transactions", txHashes: [HASH, OTHER_HASH] }),
  ])("Trigger rechecks payroll marker under admission without an event: %s", async (raw) => {
    render(<TriggerButton deploymentId={ID} network="testnet" amount="1000000" />);
    localStorage.setItem(KEY, raw);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /connect wallet & trigger/i })),
    );
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.kit).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });
  it("Trigger observes same-tab payroll notification and disables new actions", async () => {
    render(<TriggerButton deploymentId={ID} network="testnet" amount="1000000" />);
    await act(async () => savePendingPayroll(KEY, { requestId: ID, phase: "prepare" }));
    expect(
      (screen.getByRole("button", { name: /connect wallet & trigger/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("deployment request");
    expect(mocks.kit).not.toHaveBeenCalled();
  });
});
