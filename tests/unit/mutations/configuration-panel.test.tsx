import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import ConfigurationPanel from "@/components/deploy/configuration-panel";
import {
  readConfigurationRecovery,
  configurationRecoveryKey,
  saveConfigurationRecovery,
  type ConfigurationRecovery,
} from "@/components/deploy/configuration-editor.utils";
import {
  MutationStateSchema,
  MutationIntentSchema,
  MutationPrepareSchema,
} from "@/lib/mutations/schema";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import { admin, current, graph, intent, nextRecipient, recipient, transaction } from "./fixtures";
const wallet = vi.hoisted(() => ({ connect: vi.fn(), sign: vi.fn() }));
vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/prisma", () => ({ db: {} }));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: async () => ({}) }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: wallet.connect,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const deployment = { id: "11111111-1111-4111-8111-111111111111" } as Deployment;
const ownerId = "77777777-7777-4777-8777-777777777777",
  key = configurationRecoveryKey(ownerId, "testnet", deployment.id);
let state = MutationStateSchema.parse(current(deployment));
let serverPrepared: ReturnType<typeof receipt> | null;
let controlState: "PREPARED" | "SUBMITTING" | "SUCCESS" | "FAILED" | "EXPIRED";
let failPrepare: boolean,
  failSubmit: boolean,
  failCurrent: boolean,
  refuse: boolean,
  wrongProof: boolean;
let prepareRequests: { key: string; body: unknown }[];
let fetcher: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
function receipt(
  body: unknown = { admin: admin.publicKey(), arguments: intent(deployment).arguments },
) {
  const request = MutationPrepareSchema.parse(body);
  const mutation = MutationIntentSchema.parse({
    ...intent(deployment),
    arguments: request.arguments,
  });
  const tx = transaction(mutation);
  return {
    intent: "22222222-2222-4222-8222-222222222222",
    txHash: tx.hash().toString("hex"),
    walletAddress: admin.publicKey(),
    xdr: tx.toXDR(),
    expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
    network: "testnet" as const,
    networkPassphrase: Networks.TESTNET,
    feeStroops: "100",
    mutation,
  };
}
function marker(phase: ConfigurationRecovery["phase"] = "prepared"): ConfigurationRecovery {
  const p = receipt();
  serverPrepared = p;
  return {
    ownerId,
    deploymentId: deployment.id,
    network: "testnet",
    key: "original-update-key",
    request: { admin: admin.publicKey(), arguments: p.mutation.arguments },
    reviewed: state,
    phase,
    prepared: p,
    result: null,
    refusal: null,
    ...(["signing", "submitted"].includes(phase)
      ? { attemptId: "33333333-3333-4333-8333-333333333333" }
      : {}),
  };
}
function show() {
  return render(
    <ConfigurationPanel
      ownerId={ownerId}
      deploymentId={deployment.id}
      network="testnet"
      initialGraph={graph}
    />,
  );
}
async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}
async function propose() {
  await screen.findByRole("textbox", { name: "Recipient for pay" });
  fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
    target: { value: nextRecipient },
  });
  await click("Prepare update");
  await screen.findByRole("button", { name: "Load original signing review" });
}
beforeEach(() => {
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks();
  localStorage.clear();
  state = MutationStateSchema.parse(current(deployment));
  serverPrepared = null;
  controlState = "PREPARED";
  failPrepare = false;
  failSubmit = false;
  failCurrent = false;
  refuse = false;
  wrongProof = false;
  prepareRequests = [];
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, _opts: unknown, fn: (lock: object) => Promise<void>) => fn({}),
    },
  });
  wallet.connect.mockResolvedValue({
    address: admin.publicKey(),
    walletId: "fixture",
    signTransaction: wallet.sign,
  });
  wallet.sign.mockImplementation(async (xdr: string) => {
    expect(readConfigurationRecovery(key)?.phase).toBe("signing");
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    tx.sign(admin);
    return { signedTxXdr: tx.toXDR() };
  });
  fetcher = vi.fn(async (url, init) => {
    if (url.includes("/history"))
      return Response.json({
        data: {
          deploymentId: deployment.id,
          network: "testnet",
          coverage: "observed-revisions-only",
          historyComplete: false,
          revisionCoverage: [
            {
              nodeId: "pay",
              highestObservedRevision: "0",
              observedRevisionCount: "1",
              missingRevisionCount: "0",
            },
          ],
          items: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              configuration: state.configurations[0],
              observedLedger: 100,
              eventLedger: null,
              eventId: null,
              txHash: null,
            },
          ],
          nextCursor: null,
        },
      });
    if (url.endsWith("/prepare")) {
      const body = JSON.parse(String(init?.body)) as unknown,
        header = new Headers(init?.headers),
        original = readConfigurationRecovery(key);
      expect(original?.request).toEqual(body);
      expect(original?.key).toBe(header.get("Idempotency-Key"));
      prepareRequests.push({ key: header.get("Idempotency-Key")!, body });
      if (failPrepare) throw new Error("Network response lost");
      if (refuse) {
        const request = MutationPrepareSchema.parse(body);
        const proof = {
          version: 1,
          outcome: "NOT_ADMITTED",
          refusalId: "66666666-6666-4666-8666-666666666666",
          deploymentId: wrongProof ? "88888888-8888-4888-8888-888888888888" : deployment.id,
          network: "testnet",
          admin: request.admin,
          idempotencyKeyHash: createHash("sha256")
            .update(header.get("Idempotency-Key")!)
            .digest("hex"),
          requestDigest: executionRequestDigest({
            deploymentId: deployment.id,
            network: "testnet",
            input: request,
          }),
          refusedAt: new Date().toISOString(),
          reasonCode: "CONFLICT",
        };
        return Response.json(
          {
            error: {
              code: "CONFLICT",
              message: "Original attempt durably refused",
              fields: { preparationRefusal: [JSON.stringify(proof)] },
            },
          },
          { status: 409 },
        );
      }
      serverPrepared ??= receipt(body);
      return Response.json({ data: serverPrepared });
    }
    if (url.endsWith("/reconcile")) {
      if (!serverPrepared) throw new Error("No server preparation");
      return Response.json({
        data: {
          intent: serverPrepared.intent,
          state: controlState,
          transaction: {
            txHash: serverPrepared.txHash,
            network: "testnet",
            status:
              controlState === "SUCCESS"
                ? "SUCCESS"
                : controlState === "FAILED"
                  ? "FAILED"
                  : controlState === "EXPIRED"
                    ? "REJECTED"
                    : "UNKNOWN",
            ...(controlState === "EXPIRED"
              ? { error: { code: "EXPIRED", message: "Ledger coverage proves non-inclusion" } }
              : {}),
          },
        },
      });
    }
    if (url.endsWith("/submit")) {
      expect(readConfigurationRecovery(key)?.phase).toBe("submitted");
      controlState = "SUBMITTING";
      if (failSubmit) throw new Error("Submit response lost");
      return Response.json({
        data: { txHash: serverPrepared!.txHash, network: "testnet", status: "PENDING" },
      });
    }
    if (failCurrent)
      return Response.json({ error: { message: "RPC unavailable" } }, { status: 502 });
    return Response.json({ data: state });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("owner configuration editor", () => {
  it("hides unverified current terms and refuses another wallet as admin", async () => {
    saveConfigurationRecovery(key, marker());
    wallet.connect.mockResolvedValue({
      address: recipient,
      walletId: "wrong",
      signTransaction: wallet.sign,
    });
    show();
    await click("Load original signing review");
    await click("Connect admin wallet");
    expect(
      (screen.getByRole("button", { name: "Sign exact update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(wallet.sign).not.toHaveBeenCalled();
    failCurrent = true;
    await click("Check current configuration");
    await screen.findByText(/Current configuration could not be verified/);
    expect(screen.queryByText("Current confirmed values")).toBeNull();
    expect(screen.getByText("Initial deployment snapshot")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Sign exact update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("requires durable storage and an available origin lock before dispatch", async () => {
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });
    await click("Prepare update");
    await screen.findByText("Storage quota exceeded");
    expect(prepareRequests).toHaveLength(0);
    storage.mockRestore();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_key: string, _opts: unknown, fn: (lock: null) => Promise<void>) =>
          fn(null),
      },
    });
    await click("Prepare update");
    await screen.findByText(/Another tab is processing/);
    expect(prepareRequests).toHaveLength(0);
  });
  it("shows current, proposed and initial evidence separately, including full addresses/network/history gaps", async () => {
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
    expect(screen.getByText("Current confirmed values")).toBeTruthy();
    expect(screen.getByText("Initial deployment snapshot")).toBeTruthy();
    expect(screen.getByText(/Admin \/ fee payer:/).textContent).toContain(admin.publicKey());
    expect(screen.getAllByText(/Recipient \(mutable\):/)[0]!.textContent).toContain(recipient);
    expect(screen.getByText(/missing revisions 0/)).toBeTruthy();
    const result = await axe.run(document.body);
    expect(
      result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);
  });
  it("signs the exact authoritative update once and retains pending identity across reload", async () => {
    const view = show();
    await propose();
    await click("Connect admin wallet");
    await click("Sign exact update");
    await screen.findByText(/pending \/ unknown/);
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    const original = readConfigurationRecovery(key)!;
    expect(original.phase).toBe("held");
    expect(prepareRequests.every((p) => p.key === original.key)).toBe(true);
    view.unmount();
    show();
    await screen.findByText(/pending \/ unknown/);
    expect(screen.queryByRole("button", { name: "Sign exact update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare update" })).toBeNull();
    await click("Reconcile original update");
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit")).length).toBe(1),
    );
    expect(wallet.sign).toHaveBeenCalledTimes(1);
  });
  it("keeps a lost preparation response and retries the exact original body/key", async () => {
    failPrepare = true;
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    await click("Prepare update");
    await screen.findByText("Network response lost");
    const original = readConfigurationRecovery(key)!;
    expect(original.phase).toBe("preparing");
    expect(screen.queryByRole("textbox", { name: "Recipient for pay" })).toBeNull();
    failPrepare = false;
    await click("Retry original preparation");
    await screen.findByRole("button", { name: "Load original signing review" });
    expect(prepareRequests[1]).toEqual(prepareRequests[0]);
    expect(readConfigurationRecovery(key)?.key).toBe(original.key);
  });
  it("retains unknown signing outcomes without re-sign/replacement", async () => {
    saveConfigurationRecovery(key, marker());
    wallet.sign.mockRejectedValue(new Error("Wallet transport interrupted"));
    show();
    await click("Load original signing review");
    await click("Connect admin wallet");
    await click("Sign exact update");
    await screen.findByText("Wallet transport interrupted");
    expect(readConfigurationRecovery(key)?.phase).toBe("signing");
    expect(screen.queryByRole("button", { name: "Sign exact update" })).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
    await click("Reconcile original update");
    expect(readConfigurationRecovery(key)?.phase).toBe("signing");
  });
  it("retains a lost submission response and never sends or signs again after reload", async () => {
    failSubmit = true;
    const view = show();
    await propose();
    await click("Connect admin wallet");
    await click("Sign exact update");
    await screen.findByText("Submit response lost");
    expect(readConfigurationRecovery(key)?.phase).toBe("submitted");
    view.unmount();
    show();
    await screen.findByRole("button", { name: "Reconcile original update" });
    await click("Reconcile original update");
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Sign exact update" })).toBeNull();
  });
  it("restores signing only after an explicit wallet rejection", async () => {
    saveConfigurationRecovery(key, marker());
    wallet.sign.mockRejectedValue({ code: 4001, message: "User rejected" });
    show();
    await click("Load original signing review");
    await click("Connect admin wallet");
    await click("Sign exact update");
    await waitFor(() => expect(readConfigurationRecovery(key)?.phase).toBe("prepared"));
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
  });
  it("requires fresh review after external revision changes and blocks unsettled obligations", async () => {
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    const newer = structuredClone(state);
    newer.confirmedLedger = 101;
    newer.configurations[0]!.confirmedLedger = 101;
    newer.nodes[1]!.expectedRevision = "1";
    newer.configurations[0]!.revision = "1";
    state = newer;
    await click("Refresh review from chain");
    await waitFor(() =>
      expect(screen.getByText(/Current configuration confirmed at ledger 101/)).toBeTruthy(),
    );
    state = { ...newer, obligations: [{ nodeId: "pay", obligationsStroops: "1" }] };
    await click("Refresh review from chain");
    await screen.findByText(/Updates are blocked by unsettled obligations/);
    expect(
      (screen.getByRole("button", { name: "Prepare update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("blocks stale prepared updates before wallet signature", async () => {
    saveConfigurationRecovery(key, marker());
    show();
    await click("Load original signing review");
    await click("Connect admin wallet");
    const newer = structuredClone(state);
    newer.nodes[1]!.expectedRevision = "1";
    newer.configurations[0]!.revision = "1";
    state = newer;
    await click("Sign exact update");
    await screen.findByText(/A revision or unsettled obligation changed/);
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(readConfigurationRecovery(key)?.phase).toBe("prepared");
  });
  it("does not trust a tampered local transaction review", async () => {
    const r = marker();
    r.prepared = { ...r.prepared!, feeStroops: "999999" };
    saveConfigurationRecovery(key, r);
    show();
    await click("Load original signing review");
    await screen.findByText(/differs from its authoritative receipt/);
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("rejects foreign-owner recovery and storage changes during a wallet signature", async () => {
    const foreign = marker();
    foreign.ownerId = "99999999-9999-4999-8999-999999999999";
    saveConfigurationRecovery(key, foreign);
    const view = show();
    await screen.findByText(/Saved update recovery is unreadable/);
    expect(screen.queryByRole("button", { name: "Sign exact update" })).toBeNull();
    view.unmount();
    saveConfigurationRecovery(key, marker());
    let finish: (value: { signedTxXdr: string }) => void = () => {};
    wallet.sign.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    show();
    await click("Load original signing review");
    await click("Connect admin wallet");
    await click("Sign exact update");
    await waitFor(() => expect(wallet.sign).toHaveBeenCalledTimes(1));
    const actual = readConfigurationRecovery(key)!;
    saveConfigurationRecovery(key, {
      ...actual,
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const tx = TransactionBuilder.fromXDR(actual.prepared!.xdr, Networks.TESTNET) as Transaction;
    tx.sign(admin);
    await act(async () => finish({ signedTxXdr: tx.toXDR() }));
    await screen.findByText(/Signing attempt ended or changed/);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
  });
  it("detects a direct update during editing without silently rebasing the proposal", async () => {
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    const newer = structuredClone(state);
    newer.nodes[1]!.expectedRevision = "1";
    newer.configurations[0]!.revision = "1";
    state = newer;
    await click("Check current configuration");
    await screen.findByText(/Configuration changed externally after this review began/);
    expect(
      (screen.getByRole("button", { name: "Prepare update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "Recipient for pay" }) as HTMLInputElement).value,
    ).toBe(nextRecipient);
    await click("Refresh review from chain");
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Recipient for pay" }) as HTMLInputElement).value,
      ).toBe(recipient),
    );
  });
  it("freshly verifies a durable refusal before replacing its key", async () => {
    refuse = true;
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    await click("Prepare update");
    await screen.findByText(/Original attempt durably refused/);
    const old = readConfigurationRecovery(key)!;
    expect(old.phase).toBe("refused");
    failPrepare = true;
    await click("Review current terms");
    await screen.findByText("Network response lost");
    expect(readConfigurationRecovery(key)?.key).toBe(old.key);
    failPrepare = false;
    await click("Review current terms");
    await screen.findByRole("button", { name: "Prepare update" });
    expect(readConfigurationRecovery(key)).toBeNull();
    expect(prepareRequests.every((p) => p.key === old.key)).toBe(true);
  });
  it("rejects refusal evidence for another request/deployment", async () => {
    refuse = true;
    wrongProof = true;
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    await click("Prepare update");
    await screen.findByText(/Refusal evidence does not match/);
    expect(readConfigurationRecovery(key)?.phase).toBe("preparing");
    expect(screen.queryByRole("button", { name: "Review current terms" })).toBeNull();
  });
  it("only a fresh consistent terminal reconciliation permits another review", async () => {
    saveConfigurationRecovery(key, marker("submitted"));
    controlState = "EXPIRED";
    show();
    await click("Reconcile original update");
    await screen.findByRole("button", { name: "Review current terms" });
    expect(readConfigurationRecovery(key)?.phase).toBe("final");
    controlState = "SUBMITTING";
    await click("Review current terms");
    await screen.findByText(/outcome remains uncertain/);
    expect(readConfigurationRecovery(key)).not.toBeNull();
    controlState = "FAILED";
    await click("Reconcile original update");
    await click("Review current terms");
    await screen.findByRole("button", { name: "Prepare update" });
  });
  it("fails closed when browser storage or origin locking is unavailable", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    show();
    await screen.findByRole("textbox", { name: "Recipient for pay" });
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient for pay" }), {
      target: { value: nextRecipient },
    });
    await click("Prepare update");
    await screen.findByText(/cannot safely coordinate/);
    expect(prepareRequests).toHaveLength(0);
  });
});
