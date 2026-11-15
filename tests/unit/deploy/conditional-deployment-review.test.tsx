import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import DeployReview from "@/components/deploy/deploy-review";
import { conditionalPreparedFixture } from "@/tests/fixtures/conditional-deploy";
import { deployPendingKey } from "@/lib/deploy-pending";
import {
  deployPreparationKey,
  readReadyDeployPreparation,
  readConditionalDeployPreparation,
} from "@/lib/deploy-preparation";
const m = vi.hoisted(() => ({
  connect: vi.fn(),
  kit: vi.fn(),
  sign: vi.fn(),
  fetch: vi.fn(),
  poll: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: m.kit }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: m.connect,
  assertWalletAttemptActive: (s: AbortSignal) => s.throwIfAborted(),
}));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/wallet-tracking", () => ({ trackWalletConnection: vi.fn() }));
vi.mock("@/lib/hooks/use-poll-tx-status", () => ({ usePollTxStatus: () => m.poll }));
vi.mock("@/lib/friendly-toast", () => ({ toastError: m.error }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const flowId = "11111111-1111-4111-8111-111111111111";
let f: ReturnType<typeof conditionalPreparedFixture>;
let detail: Record<string, unknown>;
const props = { flowId, network: "testnet" as const, conditional: true };
beforeEach(() => {
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  f = conditionalPreparedFixture();
  detail = {
    id: f.deploymentId,
    flowId,
    network: "testnet",
    serviceState: "ACTIVE",
    status: "PENDING_SIGNATURE",
    sourceAccount: f.owner,
    deployTxHash: null,
    conditionalReview: f.conditionalReview,
    preparedRecovery: {
      status: "RESUMABLE",
      unsignedXdr: f.xdr,
      txHash: f.txHash,
      sourceAccount: f.owner,
      network: "testnet",
      networkPassphrase: f.networkPassphrase,
    },
  };
  m.kit.mockResolvedValue({});
  m.connect.mockResolvedValue({ address: f.owner, walletId: "freighter", signTransaction: m.sign });
  m.sign.mockRejectedValue({ code: 4001 });
  vi.stubGlobal("fetch", m.fetch);
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_k: string, _o: unknown, action: (l: object) => Promise<void>) => action({}),
    },
  });
  m.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({ data: url.endsWith("/prepare") ? f : detail }),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function prepare() {
  render(<DeployReview {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i }));
  });
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "RESUME DEPLOYMENT" })).toBeTruthy(),
  );
}
it("persists and reviews both branches/fullowner before any signing; acknowledgment permits only sameoriginal", async () => {
  await prepare();
  expect(m.sign).not.toHaveBeenCalled();
  expect(screen.getByRole("region").textContent).toContain(f.owner);
  expect(screen.getByRole("region").textContent).toContain("Equality follows False");
  const resume = screen.getByRole("button", { name: "RESUME DEPLOYMENT" }) as HTMLButtonElement;
  expect(resume.disabled).toBe(true);
  const ticket = readReadyDeployPreparation(
    deployPreparationKey(deployPendingKey(flowId, "testnet")),
  );
  expect(ticket?.txHash).toBe(f.txHash);
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => fireEvent.click(resume));
  expect(m.sign).toHaveBeenCalledTimes(1);
  expect(m.fetch.mock.calls.filter(([url]) => String(url).endsWith("/prepare"))).toHaveLength(1);
});
it("reload restores original review without a secondprepare and requires newack", async () => {
  const view = render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  view.unmount();
  render(<DeployReview {...props} />);
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(m.sign).not.toHaveBeenCalled();
  expect(m.fetch.mock.calls.filter(([url]) => String(url).endsWith("/prepare"))).toHaveLength(1);
});
it.each(["missing", "differentHash", "blocked"])(
  "refuses %s fresh proof before signing and retainsoriginal",
  async (kind) => {
    await prepare();
    fireEvent.click(screen.getByRole("checkbox"));
    if (kind === "missing") delete detail.conditionalReview;
    if (kind === "differentHash")
      detail.conditionalReview = { ...f.conditionalReview, txHash: "a".repeat(64) };
    if (kind === "blocked") detail.preparedRecovery = { status: "BLOCKED" };
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "RESUME DEPLOYMENT" })),
    );
    expect(m.sign).not.toHaveBeenCalled();
    expect(
      readReadyDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))?.txHash,
    ).toBe(f.txHash);
  },
);
it("missing conditionalprepare review retains ticket and never asks signature", async () => {
  m.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({
      data: url.endsWith("/prepare")
        ? { ...f, conditionalReview: undefined }
        : { ...detail, conditionalReview: undefined },
    }),
  }));
  render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    readConditionalDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))
      ?.state,
  ).toBe("preparing");
});
it("saves samekey before request, preserves a lostresponse acrossreload and recovers without signing", async () => {
  let firstRequest: unknown;
  m.fetch.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    firstRequest = JSON.parse(String(init.body));
    expect(
      readConditionalDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))
        ?.request,
    ).toEqual(firstRequest);
    throw new Error("prepare response lost");
  });
  const view = render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.unmount();
  render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "RECOVER ORIGINAL PREPARATION" })),
  );
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  const requests = m.fetch.mock.calls.filter(([url]) => String(url).endsWith("/prepare"));
  expect(requests).toHaveLength(2);
  expect(JSON.parse(String(requests[1]![1].body))).toEqual(firstRequest);
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    readReadyDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))?.txHash,
  ).toBe(f.txHash);
});
it("cannot request preparation or sign when the pre-request key cannot be saved", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("a retained v2 ready ticket never falls back to v1 when the current draft changes generation", async () => {
  const view = render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  view.unmount();
  delete detail.conditionalReview;
  render(<DeployReview {...props} conditional={false} />);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("could not be verified"),
  );
  expect(screen.queryByRole("button", { name: "RESUME DEPLOYMENT" })).toBeNull();
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    readReadyDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))?.txHash,
  ).toBe(f.txHash);
});
it("navigation during an uncertain prepare retains oldkey without overwriting the next flow UI", async () => {
  let reject!: (error: Error) => void;
  m.fetch.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejecter) => {
        reject = rejecter;
      }),
  );
  const view = render(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce());
  view.rerender(<DeployReview {...props} flowId="44444444-4444-4444-8444-444444444444" />);
  await act(async () => reject(new Error("old response lost after navigation")));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("button", { name: "RECOVER ORIGINAL PREPARATION" })).toBeNull();
  expect(m.sign).not.toHaveBeenCalled();
  expect(
    readConditionalDeployPreparation(deployPreparationKey(deployPendingKey(flowId, "testnet")))
      ?.state,
  ).toBe("preparing");
});
it("unavailable new artifacts block only fresh conditional prepare and preserve admitted original signing", async () => {
  const view = render(
    <DeployReview {...props} preparationUnavailableReason="Conditional artifacts unavailable" />,
  );
  expect(
    (screen.getByRole("button", { name: /deploy to testnet/i }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  expect(m.fetch).not.toHaveBeenCalled();
  view.rerender(<DeployReview {...props} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /deploy to testnet/i })),
  );
  await screen.findByRole("region", { name: "Conditional deployment original review" });
  view.rerender(
    <DeployReview {...props} preparationUnavailableReason="Conditional artifacts unavailable" />,
  );
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "RESUME DEPLOYMENT" })),
  );
  expect(m.sign).toHaveBeenCalledOnce();
  expect(m.fetch.mock.calls.filter(([url]) => String(url).endsWith("/prepare"))).toHaveLength(1);
});
