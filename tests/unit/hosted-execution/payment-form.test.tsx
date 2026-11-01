import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Keypair, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import axe from "axe-core";
import { createHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership";
import HostedPaymentForm from "@/components/deploy/hosted-payment-form";
import { hostedRecoveryStorageKey, readHostedRecovery } from "@/lib/hosted-execution/form";
import {
  alice,
  bob,
  deploymentId,
  hostedState,
  payer,
  preparation,
  storedMutableState,
} from "./fixtures";

const wallet = vi.hoisted(() => ({ sign: vi.fn(), connect: vi.fn() }));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: vi.fn(async () => ({})) }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: wallet.connect,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const key = hostedRecoveryStorageKey(deploymentId, "testnet");
let serial: number;
let current: ReturnType<typeof preparation> | null;
let receiptState: "PREPARED" | "SUBMITTING" | "SUCCESS" | "FAILED";
let submissions: Transaction[];
let fetcher: Mock<(url: string, options?: RequestInit) => Promise<Response>>;
beforeEach(() => {
  // Match Node Buffer's realm for noble's instanceof checks in jsdom.
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
  localStorage.clear();
  vi.clearAllMocks();
  serial = 0;
  current = null;
  receiptState = "PREPARED";
  submissions = [];
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, _options: unknown, fn: (lock: object) => Promise<void>) =>
        fn({}),
    },
  });
  wallet.connect.mockResolvedValue({
    address: payer.publicKey(),
    walletId: "fixture",
    signTransaction: wallet.sign,
  });
  wallet.sign.mockImplementation(async (xdr: string) => {
    const saved = readHostedRecovery(key);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    if (tx.sequence === "0") {
      expect(["ownership", "preparing"]).toContain(saved?.phase);
      expect(tx.operations[0]?.type).toBe("manageData");
    } else {
      expect(saved?.phase).toBe("signing");
      expect(saved?.txHash).toBe(current?.prepared.txHash);
    }
    tx.sign(signer);
    return { signedTxXdr: tx.toXDR() };
  });
  fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/state")) return Response.json({ data: hostedState });
    const body = JSON.parse(String(options?.body));
    if (url.endsWith("/ownership"))
      return Response.json({ data: createHostedOwnershipChallenge(deploymentId, body) });
    if (url.endsWith("/prepare")) {
      if (!body.ownershipProofXdr && !current)
        return Response.json(
          {
            error: {
              code: "VALIDATION",
              message: "Verify ownership",
              fields: { ownershipProofXdr: ["Required"] },
            },
          },
          { status: 422 },
        );
      expect(readHostedRecovery(key)?.recoveryKey).toBe(body.recoveryKey);
      current = preparation(body.payment, ++serial);
      receiptState = "PREPARED";
      return Response.json({ data: current });
    }
    if (url.endsWith("/submit")) {
      expect(readHostedRecovery(key)?.phase).toBe("submitted");
      const tx = TransactionBuilder.fromXDR(body.signedXdr, Networks.TESTNET) as Transaction;
      expect(tx.hash().toString("hex")).toBe(current?.prepared.txHash);
      expect(tx.signatures).toHaveLength(1);
      expect(payer.verify(tx.hash(), tx.signatures[0]!.signature())).toBe(true);
      submissions.push(tx);
      receiptState = "SUBMITTING";
      return Response.json({ data: { status: "UNKNOWN", txHash: tx.hash().toString("hex") } });
    }
    if (url.endsWith("/receipt"))
      return Response.json({
        data: {
          intent: current!.prepared.intent,
          txHash: current!.prepared.txHash,
          network: "testnet",
          expiresAt: current!.prepared.expiresAt,
          state: receiptState,
        },
      });
    throw new Error(`Unexpected fixture route ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function form(enabled = true) {
  return (
    <HostedPaymentForm
      deploymentId={deploymentId}
      flowName="Example payment"
      network="testnet"
      enabled={enabled}
    />
  );
}
async function enter(recipient = alice, waitForReview = true) {
  await screen.findByLabelText("Payment amount");
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
  fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: recipient } });
  fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  await screen.findByText(`Payer: ${payer.publicKey()}`);
  fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
  if (waitForReview) await screen.findByRole("region", { name: "Review payment" });
}
describe("wallet-only hosted execution fixture", () => {
  it("rejects a confirmed immutable minimum shortfall before proof, persistence or preparation", async () => {
    const originalFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) =>
      url.endsWith("/state")
        ? Response.json({ data: { ...hostedState, minAmountStroops: "200" } })
        : originalFetch(url, options),
    );
    render(form());
    await enter(alice, false);
    expect((await screen.findByRole("alert")).textContent).toContain("minimum");
    expect(readHostedRecovery(key)).toBeNull();
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.some(([url]) => url.endsWith("/ownership") || url.endsWith("/prepare")),
    ).toBe(false);
    expect((screen.getByLabelText("Payment amount") as HTMLInputElement).disabled).toBe(false);
  });
  it("never downgrades a restored in-flight financial preparation when a temporary missing row requests ownership", async () => {
    const recoveryKey = "ab".repeat(32);
    const request = {
      from: payer.publicKey(),
      amount: "100",
      arguments: {
        version: 1 as const,
        inputs: [{ kind: "pay" as const, nodeId: "pay", recipient: alice }],
      },
    };
    const originalFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/prepare") && current) {
        const body = JSON.parse(String(options?.body));
        expect(body.recoveryKey).toBe(recoveryKey);
        expect(body.payment).toEqual(request);
        return Response.json({ data: current });
      }
      return originalFetch(url, options);
    });
    const originalSign = wallet.sign.getMockImplementation()!;
    wallet.sign.mockImplementationOnce(async (xdr: string) => {
      expect(readHostedRecovery(key)).toEqual({ recoveryKey, phase: "preparing", request });
      expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
      expect((TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction).sequence).toBe("0");
      // The original server request commits while the same-key proof dialog is open.
      current = preparation(request);
      return originalSign(xdr);
    });
    localStorage.setItem(key, JSON.stringify({ recoveryKey, phase: "preparing", request }));
    render(form());
    await screen.findByLabelText("Payment amount");
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Recover preparation" }));
    await screen.findByRole("region", { name: "Review payment" });
    expect(readHostedRecovery(key)?.request).toEqual(request);
    expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
    expect(readHostedRecovery(key)?.recoveryKey).toBe(recoveryKey);
    expect(readHostedRecovery(key)?.txHash).toBe(current!.prepared.txHash);
    expect(wallet.sign).toHaveBeenCalledTimes(1); // Sign-only proof, never a payment.
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/ownership"))).toHaveLength(1);
    expect(submissions).toHaveLength(0);
  });

  it("recovers the same non-editable request after its first simulation failed before any intent existed", async () => {
    const originalFetch = fetcher.getMockImplementation()!;
    let failed = false;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      if (url.endsWith("/prepare") && body?.ownershipProofXdr && !failed) {
        failed = true;
        return Response.json(
          { error: { code: "UPSTREAM_RPC", message: "Simulation transport unavailable" } },
          { status: 502 },
        );
      }
      return originalFetch(url, options);
    });
    const view = render(form());
    await enter(alice, false);
    await screen.findByRole("alert");
    const saved = readHostedRecovery(key)!;
    expect(saved.phase).toBe("preparing");
    expect(current).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
    view.unmount();
    render(form());
    fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Recover preparation" }));
    await screen.findByRole("region", { name: "Review payment" });
    expect(readHostedRecovery(key)?.recoveryKey).toBe(saved.recoveryKey);
    expect(readHostedRecovery(key)?.request).toEqual(saved.request);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(submissions).toHaveLength(0);
    expect(
      fetcher.mock.calls
        .filter(([url]) => url.endsWith("/prepare"))
        .map(([, options]) => JSON.parse(String(options?.body)).recoveryKey)
        .every((key) => key === saved.recoveryKey),
    ).toBe(true);
  });
  it("does not re-prove or discard a known intent/hash when its server receipt is unexpectedly unavailable", async () => {
    const request = {
      from: payer.publicKey(),
      amount: "100",
      arguments: {
        version: 1 as const,
        inputs: [{ kind: "pay" as const, nodeId: "pay", recipient: alice }],
      },
    };
    const known = preparation(request).prepared;
    const saved = {
      recoveryKey: "ac".repeat(32),
      request,
      phase: "preparing" as const,
      intent: known.intent,
      txHash: known.txHash,
    };
    localStorage.setItem(key, JSON.stringify(saved));
    render(form());
    fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Recover preparation" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)).toEqual(saved);
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/ownership"))).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
  });
  it("permits editing after sign-only proof interruption/reload without offering a missing payment receipt", async () => {
    wallet.sign.mockRejectedValueOnce(new Error("ownership interrupted"));
    const view = render(form());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: alice } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
    await screen.findByRole("alert");
    const previousKey = readHostedRecovery(key)?.recoveryKey;
    view.unmount();
    render(form());
    expect(screen.queryByRole("button", { name: "Check payment status" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit payment inputs" }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    await enter(bob);
    expect(screen.getByText(bob)).toBeTruthy();
    expect(readHostedRecovery(key)?.recoveryKey).not.toBe(previousKey);
    expect(submissions).toHaveLength(0);
  });
  it("ownership refusal/interruption never creates or signs a payment and can safely retry its sign-only proof", async () => {
    wallet.sign.mockRejectedValueOnce(new Error("ownership transport interrupted"));
    render(form());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: alice } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)?.phase).toBe("ownership");
    expect(current).toBeNull();
    expect(submissions).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign and pay" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recover preparation" }));
    await screen.findByRole("region", { name: "Review payment" });
    expect(submissions).toHaveLength(0);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(key)).not.toContain("ownershipProofXdr");
  });
  it("provides labeled keyboard controls and an accessible payment review", async () => {
    const view = render(form());
    await enter();
    const result = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
  it("reviews and signs varied destinations using exact prepared bytes without a Paiflow account", async () => {
    render(form());
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
    await enter();
    expect(screen.getByText(alice)).toBeTruthy();
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Sign and pay" })).toBeNull();
    const saved = localStorage.getItem(key)!;
    expect(saved).not.toContain("signedXdr");
    expect(saved).not.toContain(current!.prepared.xdr);
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText(/Payment finality is still unknown/);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    receiptState = "SUCCESS";
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText(/Payment confirmed:/);
    expect(localStorage.getItem(key)).toBeNull();
    fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: bob } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
    await screen.findByRole("region", { name: "Review payment" });
    expect(screen.getByText(bob)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions[0]!.hash().equals(submissions[1]!.hash())).toBe(false);
    expect(fetcher.mock.calls.every((call) => !JSON.stringify(call[1]).includes("Bearer"))).toBe(
      true,
    );
  });
  it("an interrupted signature survives reload without automatic signing, resubmission or expiry clearing", async () => {
    const view = render(form());
    await enter();
    wallet.sign.mockRejectedValue(new Error("wallet transport interrupted"));
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)?.phase).toBe("signing");
    expect(submissions).toHaveLength(0);
    view.unmount();
    render(form(false));
    expect(screen.queryByLabelText("Payment amount")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Check payment status" }));
    await screen.findByText(/Original payment is prepared/);
    expect(readHostedRecovery(key)?.phase).toBe("signing");
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(submissions).toHaveLength(0);
  });
  it("recovers a lost preparation acknowledgement with the same browser capability and request", async () => {
    const original = fetcher.getMockImplementation()!;
    let firstKey: string | null = null;
    let firstResult: ReturnType<typeof preparation> | null = null;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
      if (!url.endsWith("/prepare")) return original(url, options);
      const body = JSON.parse(String(options?.body));
      if (!firstResult && !body.ownershipProofXdr) return original(url, options);
      if (!firstResult) {
        firstKey = body.recoveryKey;
        firstResult = preparation(body.payment, ++serial);
        current = firstResult;
        throw new Error("response lost after persistence");
      }
      expect(body.recoveryKey).toBe(firstKey);
      expect(body.payment).toEqual(readHostedRecovery(key)?.request);
      return Response.json({ data: firstResult });
    });
    render(form());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: alice } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)?.phase).toBe("preparing");
    expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recover preparation" }));
    await screen.findByRole("region", { name: "Review payment" });
    expect(serial).toBe(1);
    expect(wallet.sign).toHaveBeenCalledTimes(1);
  });
  it("a stale-revision refusal retains signed-attempt identity and never invites a duplicate payment", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) =>
      url.endsWith("/submit")
        ? Response.json(
            {
              error: {
                code: "CONFLICT",
                message: "Execution configuration changed; reconcile this preparation",
              },
            },
            { status: 409 },
          )
        : original(url, options),
    );
    render(form());
    await enter();
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)?.phase).toBe("submitted");
    expect(screen.queryByRole("button", { name: "Sign and pay" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Prepare payment" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText(/Original payment is prepared/);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(readHostedRecovery(key)?.phase).toBe("submitted");
  });
  it("wallet explicit rejection permits the same preparation, never a new payment", async () => {
    render(form());
    await enter();
    wallet.sign.mockRejectedValueOnce(Object.assign(new Error("Rejected"), { code: 4001 }));
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await screen.findByRole("alert");
    expect(readHostedRecovery(key)?.phase).toBe("prepared");
    fireEvent.click(screen.getByRole("button", { name: "Sign and pay" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(fetcher.mock.calls.filter((call) => String(call[0]).endsWith("/prepare"))).toHaveLength(
      1,
    );
  });
  it("fails before preparation or signing when durable browser storage cannot write", async () => {
    render(form());
    await screen.findByLabelText("Payment amount");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Payment recipient"), { target: { value: alice } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
    await screen.findByRole("alert");
    expect(fetcher.mock.calls.filter((call) => String(call[0]).endsWith("/prepare"))).toHaveLength(
      0,
    );
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("does not publish a disabled form or load configuration for a fresh visitor", () => {
    render(form(false));
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
    expect(screen.queryByLabelText("Payment amount")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("labels current stored terms as admin-updatable and provides no payer override input", async () => {
  const state = storedMutableState();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => {
    if (url.endsWith("/state")) return Response.json({ data: state });
    if (url.endsWith("/prepare")) {
      const body = JSON.parse(String(options?.body));
      if (!body.ownershipProofXdr) throw new Error("Missing ownership proof");
      current = preparation(body.payment, ++serial, state);
      return Response.json({ data: current });
    }
    return original(url, options);
  });
  render(form());
  await screen.findByLabelText("Payment amount");
  expect(screen.queryByLabelText("Payment recipient")).toBeNull();
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  await screen.findByText(`Payer: ${payer.publicKey()}`);
  fireEvent.click(screen.getByRole("button", { name: "Prepare payment" }));
  await screen.findByRole("region", { name: "Review payment" });
  expect(
    screen.getByText(/Recipient: stored; admin may update; allocation: stored; admin may update/),
  ).toBeTruthy();
  expect(current?.prepared.execution.nodes[1]!.expectedRevision).toBe("2");
});
