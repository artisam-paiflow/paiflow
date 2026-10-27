import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import DeployReview from "@/components/deploy/deploy-review";
import { Account, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { saveDeployPreparation, readDeployPreparation } from "@/lib/deploy-preparation";
import { deployPendingKey } from "@/lib/deploy-pending";

const mocks = vi.hoisted(() => ({
  kit: vi.fn(),
  connect: vi.fn(),
  sign: vi.fn(),
  hash: vi.fn(),
  network: vi.fn(),
  poll: vi.fn(),
  fetch: vi.fn(),
  error: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: mocks.kit }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: mocks.connect,
  assertWalletAttemptActive: (signal: AbortSignal) => signal.throwIfAborted(),
}));
vi.mock("@/lib/stellar/wallet-signature", () => ({
  preparedWalletTransactionHash: (...args: unknown[]) => {
    mocks.network(args[0], args[3]);
    return "a".repeat(64);
  },
  signedWalletTransactionHash: mocks.hash,
  assertWalletNetwork: mocks.network,
}));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => mocks.poll }));
vi.mock("@/lib/analytics/client", () => ({ track: mocks.track }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: mocks.error }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const FLOW = "11111111-1111-1111-1111-111111111111";
const DEPLOYMENT = "22222222-2222-2222-2222-222222222222";
const HASH = "a".repeat(64);
const KEY = deployPendingKey(FLOW, "testnet");
const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PASSPHRASE = "Test SDF Network ; September 2015";
const props = { flowId: FLOW, network: "testnet" as const };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function prepared() {
  return {
    ok: true,
    json: async () => ({
      data: { deploymentId: DEPLOYMENT, xdr: "unsigned", networkPassphrase: PASSPHRASE },
    }),
  };
}
function ownerStatus(status = "FAILED", txHash = HASH) {
  return { ok: true, json: async () => ({ status, txHash }) };
}
function deploy() {
  return screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement;
}
async function click() {
  await act(async () => {
    fireEvent.click(deploy());
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, action: (lock: object) => Promise<void>) =>
        action({}),
    },
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.kit.mockResolvedValue({});
  mocks.connect.mockResolvedValue({
    address: ADDRESS,
    walletId: "freighter",
    signTransaction: mocks.sign,
  });
  mocks.sign.mockResolvedValue({ signedTxXdr: "signed" });
  mocks.hash.mockReturnValue(HASH);
  mocks.poll.mockRejectedValue(new Error("Finality unknown"));
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/prepare")
      ? prepared()
      : url.endsWith("/status")
        ? ownerStatus()
        : Promise.reject(new Error("Response lost")),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployment submission recovery", () => {
  it("validates every wallet before saving public coordinates and dispatching once", async () => {
    const savedAtDispatch: (string | null)[] = [];
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/prepare")) return prepared();
      savedAtDispatch.push(localStorage.getItem(KEY));
      throw new Error("Response lost");
    });
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(mocks.network).toHaveBeenCalledWith("testnet", PASSPHRASE);
    expect(mocks.hash).toHaveBeenCalledWith("testnet", "unsigned", "signed", ADDRESS, PASSPHRASE);
    expect(savedAtDispatch.map((raw) => JSON.parse(raw!))).toEqual([
      expect.objectContaining({
        deploymentId: DEPLOYMENT,
        txHash: HASH,
        phase: "submitted",
        attemptId: expect.any(String),
      }),
    ]);
    expect(mocks.hash.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[1]!,
    );
    expect(mocks.poll).toHaveBeenCalledWith(DEPLOYMENT, HASH);
    expect(deploy().disabled).toBe(true);
    fireEvent.click(deploy());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "VIEW DEPLOYMENT" }).getAttribute("href")).toBe(
      `/deployments/${DEPLOYMENT}`,
    );
  });
  it("does not dispatch an invalid desktop envelope or wrong server network", async () => {
    mocks.hash.mockImplementation(() => {
      throw new Error("Wallet changed transaction");
    });
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      txHash: HASH,
      phase: "signing",
    });
  });
  it("does not sign when the server network mismatches the pinned network", async () => {
    mocks.network.mockImplementation(() => {
      throw new Error("Network mismatch");
    });
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("does not prepare or sign when recovery storage or browser locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.kit).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("cannot dispatch when durable marker persistence fails", async () => {
    render(<DeployReview {...props} />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(deploy().disabled).toBe(true);
  });
  it("never repeats prepare or submit after remount and status-only recovery", async () => {
    localStorage.setItem(KEY, JSON.stringify({ deploymentId: DEPLOYMENT, txHash: HASH }));
    const view = render(<DeployReview {...props} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(mocks.kit).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    view.unmount();
    render(<DeployReview {...props} />);
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(2));
    mocks.poll.mockResolvedValue({ status: "FAILED" });
    fireEvent.click(screen.getByRole("button", { name: "CHECK DEPLOYMENT STATUS" }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`/api/deployments/${DEPLOYMENT}/status`);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("post-dispatch flow changes suppress old UI but retain and reconcile the captured deployment", async () => {
    const outcome = deferred<{ status: string }>();
    const response = deferred<ReturnType<typeof prepared>>();
    mocks.poll.mockReturnValue(outcome.promise);
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/prepare")
        ? prepared()
        : url.endsWith("/status")
          ? ownerStatus()
          : response.promise,
    );
    const view = render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledOnce(), { timeout: 3000 });
    view.rerender(<DeployReview {...props} flowId="33333333-3333-3333-3333-333333333333" />);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await act(async () => outcome.resolve({ status: "FAILED" }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    response.resolve(prepared());
  });
  it("retains a signing reservation across navigation and ignores a late signature", async () => {
    const signed = deferred<{ signedTxXdr: string }>();
    mocks.sign.mockReturnValueOnce(signed.promise);
    const view = render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    const recorded = localStorage.getItem(KEY);
    await act(async () => view.unmount());
    render(<DeployReview {...props} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(deploy().disabled).toBe(true);
    await act(async () => signed.resolve({ signedTxXdr: "old-signature" }));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(recorded);
  });
  it("accepts authoritative success during recovery without repeating a write", async () => {
    localStorage.setItem(KEY, JSON.stringify({ deploymentId: DEPLOYMENT, txHash: HASH }));
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    mocks.fetch.mockResolvedValue(ownerStatus("CONFIRMED"));
    render(<DeployReview {...props} />);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Deployment confirmed");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`/api/deployments/${DEPLOYMENT}/status`);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each(["SUBMITTED", "FAILED", "wrong-hash", "unavailable"])(
    "keeps the marker when chain succeeded but owner bookkeeping is %s",
    async (kind) => {
      localStorage.setItem(KEY, JSON.stringify({ deploymentId: DEPLOYMENT, txHash: HASH }));
      mocks.poll.mockResolvedValue({ status: "SUCCESS" });
      mocks.fetch.mockResolvedValue(
        kind === "unavailable"
          ? { ok: false }
          : ownerStatus(
              kind === "wrong-hash" ? "CONFIRMED" : kind,
              kind === "wrong-hash" ? "b".repeat(64) : HASH,
            ),
      );
      render(<DeployReview {...props} />);
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("still unknown"),
      );
      expect(localStorage.getItem(KEY)).not.toBeNull();
      expect(deploy().disabled).toBe(true);
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`/api/deployments/${DEPLOYMENT}/status`);
    },
  );
  it("recovers a submit HTTP500 through owner confirmation without another prepare/sign/submit", async () => {
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/prepare")
        ? prepared()
        : url.endsWith("/submit")
          ? { ok: false, status: 500 }
          : ownerStatus("SUBMITTED"),
    );
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    mocks.fetch.mockResolvedValue(ownerStatus("CONFIRMED"));
    fireEvent.click(screen.getByRole("button", { name: "CHECK DEPLOYMENT STATUS" }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/deployments/prepare",
      `/api/deployments/${DEPLOYMENT}/submit`,
      `/api/deployments/${DEPLOYMENT}/status`,
      `/api/deployments/${DEPLOYMENT}/status`,
    ]);
  });
  it("retains corrupt status instead of silently allowing a fresh deployment", () => {
    localStorage.setItem(KEY, "corrupt");
    render(<DeployReview {...props} />);
    expect(deploy().disabled).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe("corrupt");
  });
});

describe("deployment identity before wallet response", () => {
  it.each(["timeout", "connection_lost"])(
    "holds the prepared identity after %s and reload without faking a server submission",
    async (ext) => {
      mocks.sign.mockImplementation(async () => {
        expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
          deploymentId: DEPLOYMENT,
          txHash: HASH,
          phase: "signing",
          attemptId: expect.any(String),
        });
        throw { code: -1, ext };
      });
      const view = render(<DeployReview {...props} />);
      await click();
      await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
      const recorded = localStorage.getItem(KEY);
      expect(screen.getByRole("status").textContent).toContain("No submission is recorded");
      view.unmount();
      render(<DeployReview {...props} />);
      await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith(DEPLOYMENT, HASH));
      expect(localStorage.getItem(KEY)).toBe(recorded);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.sign).toHaveBeenCalledOnce();
      expect(deploy().disabled).toBe(true);
    },
  );
  it("explicit rejection releases its own signing reservation without polling or submitting", async () => {
    mocks.sign.mockRejectedValue({ code: -4, ext: "user_rejected" });
    render(<DeployReview {...props} />);
    await click();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/prepare"))).toHaveLength(1);
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/submit"))).toBe(false);
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(deploy().disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(`${KEY}:preparation`)!)).toMatchObject({
      state: "ready",
      txHash: HASH,
    });
  });
  it("a signing marker with chain finality still holds until matching owner bookkeeping exists", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        deploymentId: DEPLOYMENT,
        txHash: HASH,
        phase: "signing",
        attemptId: crypto.randomUUID(),
      }),
    );
    mocks.poll.mockResolvedValue({ status: "SUCCESS" });
    mocks.fetch.mockResolvedValue(ownerStatus("BUILDING", ""));
    render(<DeployReview {...props} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("still unknown"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`/api/deployments/${DEPLOYMENT}/status`);
  });
});

// These component tests isolate crypto validation through the existing mock above;
// real source/hash/signature validation is exercised by wallet-signature tests.
const UNSIGNED = new TransactionBuilder(new Account(ADDRESS, "1"), {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
  .setTimeout(180)
  .build()
  .toXDR();
function preparationTicket() {
  saveDeployPreparation(`${KEY}:preparation`, {
    deploymentId: DEPLOYMENT,
    txHash: HASH,
    address: ADDRESS,
  });
}
function ownedPreparation(
  change: Record<string, unknown> = {},
  recoveryChange: Record<string, unknown> = {},
) {
  return {
    ok: true,
    json: async () => ({
      data: {
        id: DEPLOYMENT,
        flowId: FLOW,
        network: "testnet",
        sourceAccount: ADDRESS,
        serviceState: "ACTIVE",
        status: "PENDING_SIGNATURE",
        deployTxHash: null,
        preparedRecovery: {
          status: "RESUMABLE",
          unsignedXdr: UNSIGNED,
          txHash: HASH,
          sourceAccount: ADDRESS,
          network: "testnet",
          networkPassphrase: PASSPHRASE,
          ...recoveryChange,
        },
        ...change,
      },
    }),
  };
}

describe("combined prepared deployment recovery", () => {
  it("resumes only a proven safe original preparation without preparing again", async () => {
    preparationTicket();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/submit") ? Promise.reject(new Error("lost")) : ownedPreparation(),
    );
    render(<DeployReview {...props} />);
    const resume = await screen.findByRole("button", { name: "RESUME DEPLOYMENT" });
    await act(async () => {
      fireEvent.click(resume);
    });
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(UNSIGNED, {
      address: ADDRESS,
      networkPassphrase: PASSPHRASE,
    });
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/prepare"))).toBe(false);
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
    expect(readDeployPreparation(`${KEY}:preparation`)?.state).toBe("signing");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      phase: "submitted",
      txHash: HASH,
    });
  });
  it.each(["legacy-only", "consumed-provenance", "missing-provenance"])(
    "does not infer safe signing from server RESUMABLE: %s",
    async (kind) => {
      sessionStorage.setItem(`paiflow-deploy-recovery:testnet:${FLOW}`, DEPLOYMENT);
      if (kind === "consumed-provenance")
        localStorage.setItem(
          `${KEY}:preparation`,
          JSON.stringify({
            deploymentId: DEPLOYMENT,
            txHash: HASH,
            address: ADDRESS,
            state: "signing",
            attemptId: crypto.randomUUID(),
          }),
        );
      mocks.fetch.mockResolvedValue(ownedPreparation());
      render(<DeployReview {...props} />);
      await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
      expect(screen.queryByRole("button", { name: "RESUME DEPLOYMENT" })).toBeNull();
      expect(deploy().disabled).toBe(true);
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
    },
  );
  it("restores safe signing only after matching explicit rejection, including reload", async () => {
    mocks.sign.mockRejectedValueOnce({ code: -4, ext: "user_rejected" });
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/prepare") ? prepared() : ownedPreparation(),
    );
    const view = render(<DeployReview {...props} />);
    await click();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readDeployPreparation(`${KEY}:preparation`)?.state).toBe("ready");
    view.unmount();
    render(<DeployReview {...props} />);
    expect(await screen.findByRole("button", { name: "RESUME DEPLOYMENT" })).toBeTruthy();
    expect(mocks.sign).toHaveBeenCalledOnce();
  });
  it.each([
    "wrong-flow",
    "wrong-network",
    "wrong-owner-response-id",
    "retiring",
    "wrong-source",
    "wrong-hash",
    "blocked",
    "wrong-passphrase",
  ])("refuses incompatible original metadata: %s", async (kind) => {
    preparationTicket();
    const change: Record<string, unknown> = {};
    const recoveryChange: Record<string, unknown> = {};
    if (kind === "wrong-flow") change.flowId = "different";
    if (kind === "wrong-network") change.network = "mainnet";
    if (kind === "wrong-owner-response-id") change.id = "different";
    if (kind === "retiring") change.serviceState = "RETIRING";
    if (kind === "wrong-source") change.sourceAccount = "different";
    if (kind === "wrong-hash") recoveryChange.txHash = "b".repeat(64);
    if (kind === "blocked") change.preparedRecovery = { status: "BLOCKED" };
    if (kind === "wrong-passphrase") {
      recoveryChange.networkPassphrase = "wrong";
      mocks.network.mockImplementation(() => {
        throw new Error("wrong network");
      });
    }
    mocks.fetch.mockResolvedValue(ownedPreparation(change, recoveryChange));
    render(<DeployReview {...props} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "RESUME DEPLOYMENT" })).toBeNull();
    expect(deploy().disabled).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("refuses a different connected account without consuming the original safe preparation", async () => {
    preparationTicket();
    mocks.fetch.mockResolvedValue(ownedPreparation());
    mocks.connect.mockResolvedValue({
      address: "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ",
      walletId: "freighter",
      signTransaction: mocks.sign,
    });
    render(<DeployReview {...props} />);
    const resume = await screen.findByRole("button", { name: "RESUME DEPLOYMENT" });
    await act(async () => fireEvent.click(resume));
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(readDeployPreparation(`${KEY}:preparation`)?.state).toBe("ready");
  });
  it.each(["signing", "submitted"] as const)(
    "an existing %s hash blocks resume and bare expiry",
    async (phase) => {
      preparationTicket();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          deploymentId: DEPLOYMENT,
          txHash: HASH,
          phase,
          attemptId: crypto.randomUUID(),
        }),
      );
      mocks.fetch.mockResolvedValue(ownedPreparation({}, { status: "EXPIRED" }));
      render(<DeployReview {...props} />);
      await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith(DEPLOYMENT, HASH));
      expect(screen.queryByRole("button", { name: "RESUME DEPLOYMENT" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Prepare another" })).toBeNull();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(localStorage.getItem(KEY)).not.toBeNull();
    },
  );
  it("requires explicit replacement and freshly verified expiry of a safe preparation", async () => {
    preparationTicket();
    mocks.fetch.mockResolvedValue(ownedPreparation({}, { status: "EXPIRED" }));
    render(<DeployReview {...props} />);
    const replace = await screen.findByRole("button", { name: "Prepare another" });
    expect(deploy().disabled).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(replace));
    expect(deploy().disabled).toBe(false);
    expect(readDeployPreparation(`${KEY}:preparation`)).toBeNull();
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/prepare"))).toBe(false);
  });
  it("does not treat a bare EXPIRED response as sufficient replacement proof", async () => {
    preparationTicket();
    mocks.fetch.mockResolvedValue(ownedPreparation({ preparedRecovery: { status: "EXPIRED" } }));
    render(<DeployReview {...props} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Prepare another" })).toBeNull();
    expect(deploy().disabled).toBe(true);
  });
  it("fails closed on conflicting legacy and current recovery identities", async () => {
    preparationTicket();
    sessionStorage.setItem(
      `paiflow-deploy-recovery:testnet:${FLOW}`,
      "33333333-3333-3333-3333-333333333333",
    );
    render(<DeployReview {...props} />);
    await click();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(deploy().disabled).toBe(true);
  });
  it("retries the identical signed bytes only on explicit NOT_ACCEPTED and loses that permission after an unknown response", async () => {
    let sends = 0;
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/prepare")) return prepared();
      if (url.endsWith("/submit")) {
        sends++;
        if (sends === 1)
          return {
            ok: false,
            status: 502,
            json: async () => ({
              error: { code: "UPSTREAM_RPC", submissionStatus: "NOT_ACCEPTED" },
            }),
          };
        throw new Error("lost response");
      }
      throw new Error("unexpected request");
    });
    render(<DeployReview {...props} />);
    await click();
    const retry = await screen.findByRole("button", { name: "RETRY SUBMISSION" });
    expect(mocks.poll).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(retry));
    const sendsArgs = mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/submit"));
    expect(sendsArgs).toHaveLength(2);
    expect(sendsArgs[0]).toEqual(sendsArgs[1]);
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/prepare"))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "RETRY SUBMISSION" })).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(JSON.stringify(Object.values(localStorage))).not.toContain("signed");
  });
  it.each(["missing-code", "wrong-status", "generic-error"])(
    "does not infer submission refusal from %s",
    async (kind) => {
      mocks.fetch.mockImplementation(async (url: string) =>
        url.endsWith("/prepare")
          ? prepared()
          : {
              ok: false,
              status: kind === "wrong-status" ? 500 : 502,
              json: async () => ({
                error: {
                  code: kind === "missing-code" ? undefined : "UPSTREAM_RPC",
                  submissionStatus: kind === "generic-error" ? undefined : "NOT_ACCEPTED",
                },
              }),
            },
      );
      render(<DeployReview {...props} />);
      await click();
      expect(screen.queryByRole("button", { name: "RETRY SUBMISSION" })).toBeNull();
      expect(localStorage.getItem(KEY)).not.toBeNull();
    },
  );
});
