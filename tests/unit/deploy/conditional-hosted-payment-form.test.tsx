import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import HostedPaymentForm from "@/components/deploy/hosted-payment-form";
import { hostedRecoveryStorageKey } from "@/lib/hosted-execution/form";
import {
  ConditionalHostedPreparedSchema,
  type ConditionalHostedPrepared,
} from "@/lib/hosted-execution/conditional-schema";
import {
  ConditionalExecutePrepareSchema,
  ConditionalExecutionDiscoverySchema,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import {
  ConditionalExecutionIntentSchema,
  selectConditionalBranch,
  type ConditionalDefinition,
} from "@/lib/flows/conditional-v2";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptancePlan,
  conditionalWallet,
} from "@/tests/fixtures/conditional-v2-acceptance";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import { conditionalHostedPaymentReview } from "@/lib/hosted-execution/conditional-review";
import { conditionalHostedOwnershipBinding } from "@/lib/hosted-execution/conditional-ownership-binding";
import { conditionalHostedOwnershipTransaction } from "@/lib/stellar/conditional-ownership-transaction";
import {
  hostedUiProtocol,
  readHostedUiRecovery,
} from "@/components/deploy/hosted-payment-protocol";
vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
const wallet = vi.hoisted(() => ({ sign: vi.fn(), connect: vi.fn() }));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: async () => ({}) }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: wallet.connect,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const id = "12281228-1228-4228-8228-122812281228",
  key = hostedRecoveryStorageKey(id, "testnet"),
  recipient = conditionalWallet(31);
let payer: Keypair,
  state: SupportedConditionalExecutionState,
  current: ConditionalHostedPrepared | null,
  submissions: number,
  failPrepare: boolean,
  failSubmit: boolean,
  failState: boolean;
let receiptState: "PREPARED" | "SUBMITTING" | "SUCCESS" | "FAILED" | "EXPIRED";
let fetcher: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const protocol = () => hostedUiProtocol(true, id, "testnet");
const saved = () => readHostedUiRecovery(key, protocol());
function makeState(
  kind: "return_to_owner" | "pay" | "split" = "return_to_owner",
  definition?: ConditionalDefinition,
  revisions: Record<string, string> = {},
) {
  const d = definition ?? conditionalAcceptanceDefinition("amount_gt", "pay", kind);
  d.condition.thresholdMode = "mutable";
  if (!definition) d.condition.thresholdStroops = "50";
  if (d.falseBranch.kind === "pay") d.falseBranch.policy.payoutValue = "mutable";
  const plan = conditionalAcceptancePlan(d, CONDITIONAL_V2_WASM_HASHES);
  const parsed = ConditionalExecutionDiscoverySchema.parse({
    version: 2,
    supported: true,
    policyVersion: 2,
    deploymentId: id,
    network: "testnet",
    definition: plan.definition,
    nodes: plan.bindings.map((node) => ({
      ...node,
      expectedRevision: revisions[node.nodeId] ?? "0",
    })),
    confirmedLedger: 100,
    statuses: plan.manifest.nodes.map(({ state }) => ({
      state: { ...state, revision: revisions[state.nodeId] ?? "0" },
      obligationsStroops: "0",
    })),
  });
  if (!parsed.supported) throw new Error("fixture unsupported");
  return parsed;
}
function prepare(raw: unknown) {
  const payment = ConditionalExecutePrepareSchema.parse(raw),
    selection = selectConditionalBranch(state.definition, payment.amount);
  const execution = ConditionalExecutionIntentSchema.parse({
    version: 2,
    deploymentId: id,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: state.nodes[0]!.contractAddress,
    assetContract: state.definition.assetContract,
    payer: payment.from,
    amountStroops: payment.amount,
    nonce: "ab".repeat(32),
    expiresAtLedger: 150,
    definition: state.definition,
    nodes: state.nodes,
    arguments: payment.arguments,
    ...selection,
  });
  const tx = new TransactionBuilder(new Account(payment.from, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(execution.rootContract).call("execute_v2", ...executionV2Args(execution)),
    )
    .setTimeout(180)
    .build();
  return ConditionalHostedPreparedSchema.parse({
    version: 2,
    prepared: {
      intent: "22222222-2222-4222-8222-222222222222",
      txHash: tx.hash().toString("hex"),
      walletAddress: payment.from,
      xdr: tx.toXDR(),
      expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      execution,
    },
    feeStroops: tx.fee,
    ...conditionalHostedPaymentReview(execution),
  });
}
async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}
const view = (enabled = true) => (
  <HostedPaymentForm
    deploymentId={id}
    flowName={enabled ? "Conditional payment" : "Payment receipt"}
    network="testnet"
    enabled={enabled}
    conditional
  />
);
async function enter(amount = "0.00001", review = true) {
  await screen.findByLabelText("Payment amount");
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: amount } });
  const field = screen.queryByLabelText("Payment recipient");
  if (field) fireEvent.change(field, { target: { value: recipient } });
  await click("Connect wallet");
  await screen.findByText(`Payer: ${payer.publicKey()}`);
  await click("Prepare payment");
  if (review) await screen.findByRole("region", { name: "Review payment" });
}
function acknowledge() {
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.clearAllMocks();
  localStorage.clear();
  payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
  state = makeState();
  current = null;
  submissions = 0;
  receiptState = "PREPARED";
  failPrepare = false;
  failSubmit = false;
  failState = false;
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
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    expect(tx.sequence === "0" ? ["ownership", "preparing"] : ["signing"]).toContain(
      saved()?.phase,
    );
    tx.sign(payer);
    return { signedTxXdr: tx.toXDR() };
  });
  fetcher = vi.fn(async (url, init) => {
    expect(new URL(url, "https://paiflow.invalid").searchParams.get("version")).toBe("2");
    const operation = new URL(url, "https://paiflow.invalid").pathname.split("/").at(-1);
    if (operation === "state")
      return failState
        ? Response.json({ error: { message: "Payment form is unavailable" } }, { status: 404 })
        : Response.json({ data: state });
    const body = JSON.parse(String(init?.body));
    if (operation === "ownership") {
      const bindingDigest = await conditionalHostedOwnershipBinding(
        id,
        body,
        "testnet",
        Networks.TESTNET,
      );
      return Response.json({
        data: {
          version: 2,
          bindingDigest,
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          xdr: conditionalHostedOwnershipTransaction(
            body.payment.from,
            bindingDigest,
            Networks.TESTNET,
            Math.floor(Date.now() / 1000),
          ).toXDR(),
        },
      });
    }
    if (operation === "prepare") {
      expect(saved()?.recoveryKey).toBe(body.recoveryKey);
      expect(saved()?.request).toEqual(body.payment);
      if (!body.ownershipProofXdr && !current)
        return Response.json(
          {
            error: {
              code: "VALIDATION",
              message: "Ownership required",
              fields: { ownershipProofXdr: ["Required"] },
            },
          },
          { status: 422 },
        );
      if (failPrepare) throw new Error("Preparation response unavailable");
      current ??= prepare(body.payment);
      return Response.json({ data: current });
    }
    if (operation === "submit") {
      expect(saved()?.phase).toBe("submitted");
      submissions++;
      receiptState = "SUBMITTING";
      if (failSubmit) throw new Error("Submission response unavailable");
      return Response.json({
        data: { version: 2, txHash: current!.prepared.txHash, status: "PENDING" },
      });
    }
    if (operation === "receipt") {
      if (!current)
        return Response.json(
          { error: { message: "Original receipt unavailable" } },
          { status: 404 },
        );
      return Response.json({
        data: {
          version: 2,
          intent: current.prepared.intent,
          txHash: current.prepared.txHash,
          state: receiptState,
          network: "testnet",
          expiresAt: current.prepared.expiresAt,
        },
      });
    }
    throw new Error(`Unexpected route ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("conditional hosted single payment engine", () => {
  it("requires explicit original acknowledgement, signs once and retains submitted identity across reload", async () => {
    const page = render(view());
    await enter();
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "Sign and pay" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
    acknowledge();
    await click("Sign and pay");
    await waitFor(() => expect(submissions).toBe(1));
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    const original = saved();
    expect(original?.phase).toBe("submitted");
    expect(JSON.stringify(original)).not.toContain("xdr");
    page.unmount();
    render(view());
    await click("Check payment status");
    expect(saved()?.txHash).toBe(original?.txHash);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(submissions).toBe(1);
  });
  it("clears terminal fields on a branch flip and requires them fresh on return", async () => {
    state = makeState("pay");
    render(view());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    fireEvent.change(await screen.findByLabelText("Payment recipient"), {
      target: { value: recipient },
    });
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.000004" } });
    await waitFor(() =>
      expect((screen.getByLabelText("Payment recipient") as HTMLInputElement).value).toBe(""),
    );
    fireEvent.change(screen.getByLabelText("Payment recipient"), {
      target: { value: conditionalWallet(32) },
    });
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    await waitFor(() =>
      expect((screen.getByLabelText("Payment recipient") as HTMLInputElement).value).toBe(""),
    );
  });
  it("clears selected Split rosters on a branch flip and submits only rebuilt selected inputs", async () => {
    state = makeState("split");
    render(view());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.000004" } });
    await click("Add destination");
    fireEvent.change(screen.getByLabelText("Additional recipient 1"), {
      target: { value: recipient },
    });
    fireEvent.change(screen.getByLabelText("Percentage for additional recipient 1"), {
      target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    await screen.findByLabelText("Payment recipient");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.000004" } });
    await screen.findByRole("button", { name: "Add destination" });
    expect(screen.queryByLabelText("Additional recipient 1")).toBeNull();
    await click("Add destination");
    fireEvent.change(screen.getByLabelText("Additional recipient 1"), {
      target: { value: recipient },
    });
    fireEvent.change(screen.getByLabelText("Percentage for additional recipient 1"), {
      target: { value: "90" },
    });
    await click("Connect wallet");
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    await click("Prepare payment");
    await screen.findByRole("region", { name: "Review payment" });
    expect(saved()?.request.arguments?.inputs.map((input) => input.nodeId)).toEqual(["no"]);
  });
  it("reviews Return to owner separately from payer refunds", async () => {
    render(view());
    await enter("0.000004");
    expect(current!.prepared.execution.selectedBranch).toBe("false");
    expect(current!.rows.at(-1)!.recipient).toBe(state.definition.owner);
    expect(state.definition.owner).not.toBe(payer.publicKey());
    expect(screen.getByText("Return to immutable deployment owner")).toBeTruthy();
    expect(current!.refundStroops).toBe("0");
  });
  it.each(["inactive revision", "failed read"])(
    "disables known %s signing with original receipt retained",
    async (change) => {
      state = makeState("pay");
      render(view());
      await enter();
      acknowledge();
      const original = localStorage.getItem(key);
      if (change === "failed read") failState = true;
      else {
        state = structuredClone(state);
        state.nodes[4]!.expectedRevision = "1";
        state.statuses[4]!.state.revision = "1";
      }
      await click("Refresh payment terms");
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Sign and pay" }) as HTMLButtonElement).disabled,
        ).toBe(true),
      );
      expect(localStorage.getItem(key)).toBe(original);
      expect(wallet.sign).toHaveBeenCalledTimes(1);
      await click("Check payment status");
    },
  );
  it("checks a newly changed inactive revision again immediately before wallet signing", async () => {
    state = makeState("pay");
    render(view());
    await enter();
    acknowledge();
    state = structuredClone(state);
    state.nodes[4]!.expectedRevision = "1";
    state.statuses[4]!.state.revision = "1";
    await click("Sign and pay");
    await screen.findByText(/Conditional terms changed/);
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(submissions).toBe(0);
    expect(saved()?.phase).toBe("prepared");
  });
  it("does not let an older initial read overwrite a newer verified refresh", async () => {
    const original = structuredClone(state);
    let finish: (value: Response) => void = () => {};
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(view());
    const definition = structuredClone(state.definition);
    definition.condition.thresholdStroops = "1000";
    state = makeState("return_to_owner", definition, { condition: "1" });
    await click("Refresh payment terms");
    await screen.findByText(/Threshold: 1000 stroops/);
    await act(async () => finish(Response.json({ data: original })));
    expect(screen.getByText(/Threshold: 1000 stroops/)).toBeTruthy();
    expect(screen.queryByText(/Threshold: 50 stroops/)).toBeNull();
  });
  it("independently rejects a tampered ownership binding before wallet access", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (!url.includes("/ownership?")) return response;
      const body = await response.json();
      body.data.bindingDigest = "cd".repeat(32);
      return Response.json(body);
    });
    render(view());
    await enter("0.00001", false);
    await screen.findByRole("alert");
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(saved()?.phase).toBe("ownership");
    expect(submissions).toBe(0);
  });
  it("holds original submitted identity when the response claims a different hash", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (!url.includes("/submit?")) return response;
      return Response.json({ data: { version: 2, status: "PENDING", txHash: "cd".repeat(32) } });
    });
    render(view());
    await enter();
    acknowledge();
    await click("Sign and pay");
    await screen.findByText(/Submission receipt differs/);
    expect(saved()?.phase).toBe("submitted");
    expect(saved()?.txHash).toBe(current!.prepared.txHash);
    expect(submissions).toBe(1);
  });
  it("does not gate payments on inactive obligations or ledger churn", async () => {
    state = makeState("pay");
    render(view());
    await enter();
    acknowledge();
    state = structuredClone(state);
    state.confirmedLedger++;
    state.statuses[3]!.obligationsStroops = "9";
    await click("Refresh payment terms");
    await click("Sign and pay");
    await waitFor(() => expect(submissions).toBe(1));
  });
  it("retains obsolete branch inputs held after dispatched failure during refresh and reload", async () => {
    state = makeState("pay");
    failPrepare = true;
    const page = render(view());
    await enter("0.00001", false);
    await screen.findByText("Preparation response unavailable");
    const original = localStorage.getItem(key);
    expect(saved()?.phase).toBe("preparing");
    const definition = structuredClone(state.definition);
    definition.condition.thresholdStroops = "1000";
    state = makeState("pay", definition, { condition: "1" });
    await click("Refresh payment terms");
    expect(localStorage.getItem(key)).toBe(original);
    expect(screen.getByText("Original saved payment inputs")).toBeTruthy();
    expect(screen.getByText(recipient)).toBeTruthy();
    page.unmount();
    render(view());
    await click("Connect original payer wallet");
    await screen.findByRole("button", { name: "Recover preparation" });
    expect(localStorage.getItem(key)).toBe(original);
    expect(screen.queryByLabelText("Payment amount")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit payment inputs" })).toBeNull();
  });
  it("retains unknown signing without submission or replacement", async () => {
    render(view());
    await enter();
    acknowledge();
    wallet.sign.mockRejectedValueOnce(new Error("Wallet outcome unknown"));
    await click("Sign and pay");
    await screen.findByText("Wallet outcome unknown");
    expect(saved()?.phase).toBe("signing");
    expect(submissions).toBe(0);
    await click("Check payment status");
    expect(saved()?.phase).toBe("signing");
  });
  it("rejects a cross-tab signing attempt change before send", async () => {
    render(view());
    await enter();
    acknowledge();
    let finish: (value: { signedTxXdr: string }) => void = () => {};
    wallet.sign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click("Sign and pay");
    await waitFor(() => expect(saved()?.phase).toBe("signing"));
    const actual = saved()!;
    localStorage.setItem(
      key,
      JSON.stringify({ ...actual, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
    const tx = TransactionBuilder.fromXDR(current!.prepared.xdr, Networks.TESTNET) as Transaction;
    tx.sign(payer);
    await act(async () => finish({ signedTxXdr: tx.toXDR() }));
    await screen.findByText(/Signing attempt ended or changed/);
    expect(submissions).toBe(0);
    expect(saved()?.txHash).toBe(actual.txHash);
  });
  it("refuses another tab's origin lock before wallet access", async () => {
    render(view());
    await screen.findByLabelText("Payment amount");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_key: string, _options: unknown, fn: (lock: null) => Promise<void>) =>
          fn(null),
      },
    });
    await click("Connect wallet");
    await screen.findByText(/Another tab is processing/);
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("does not clear a newer cross-tab original when an older terminal receipt arrives", async () => {
    render(view());
    await enter();
    receiptState = "SUCCESS";
    const original = fetcher.getMockImplementation()!;
    const next = {
      version: 2,
      deploymentId: id,
      network: "testnet",
      recoveryKey: "cd".repeat(32),
      request: { from: payer.publicKey(), amount: "200", arguments: { version: 2, inputs: [] } },
      phase: "ownership",
    };
    fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (url.includes("/receipt?")) {
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }
      return response;
    });
    await click("Check payment status");
    await screen.findByText(/Original receipt changed in another tab/);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(next));
    expect(saved()?.recoveryKey).toBe(next.recoveryKey);
    expect(submissions).toBe(0);
  });
  it("retains lost submission acknowledgement without another signature or send", async () => {
    failSubmit = true;
    const page = render(view());
    await enter();
    acknowledge();
    await click("Sign and pay");
    await screen.findByText("Submission response unavailable");
    const original = saved();
    page.unmount();
    render(view());
    await click("Check payment status");
    expect(saved()?.txHash).toBe(original?.txHash);
    expect(submissions).toBe(1);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
  });
  it("allows only ownership cancellation to edit inputs", async () => {
    wallet.sign.mockRejectedValueOnce({ code: 4001, message: "Rejected proof" });
    render(view());
    await enter("0.00001", false);
    await screen.findByRole("button", { name: "Edit payment inputs" });
    expect(saved()?.phase).toBe("ownership");
    await click("Edit payment inputs");
    expect(saved()).toBeNull();
  });
  it("holds unreadable recovery bytes under the same key", async () => {
    const bytes = JSON.stringify({ version: 7, recoveryKey: "aa".repeat(32) });
    localStorage.setItem(key, bytes);
    render(view());
    await screen.findByText(/Payment recovery storage is unavailable or invalid/);
    expect(localStorage.getItem(key)).toBe(bytes);
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("requires durable storage before any proof or prepare request", async () => {
    render(view());
    await screen.findByLabelText("Payment amount");
    fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "0.00001" } });
    fireEvent.change(await screen.findByLabelText("Payment recipient"), {
      target: { value: recipient },
    });
    await click("Connect wallet");
    await screen.findByText(`Payer: ${payer.publicKey()}`);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("No durable storage");
    });
    await click("Prepare payment");
    await screen.findByText("No durable storage");
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => url.includes("/ownership?"))).toBe(false);
  });
  it("keeps generic receipt access after opt-out without current reads", async () => {
    render(view());
    await enter();
    cleanup();
    fetcher.mockClear();
    render(view(false));
    expect(screen.getByRole("heading", { name: "Payment receipt" })).toBeTruthy();
    await click("Check payment status");
    expect(fetcher.mock.calls.every(([url]) => url.includes("/receipt?"))).toBe(true);
    expect(submissions).toBe(0);
  });
  it("has labelled keyboard review, network chip and no serious accessibility violations", async () => {
    render(view());
    await enter();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    checkbox.focus();
    await userEvent.setup().keyboard(" ");
    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(
      (screen.getByRole("button", { name: "Sign and pay" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    const result = await axe.run(document.body);
    expect(
      result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);
  });
});
