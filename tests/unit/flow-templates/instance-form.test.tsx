import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Keypair, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import axe from "axe-core";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { InstanceCompiledTermsSchema } from "@/lib/flow-instances/compiled-review-schema";
import InstanceForm from "@/components/flow-templates/instance-form";
import {
  instanceRecoveryKey,
  readInstanceRecovery,
  writeInstanceRecovery,
  type InstanceRecovery,
} from "@/components/flow-templates/instance-recovery.utils";
import {
  ownerId,
  templateId,
  versionId,
  instanceId,
  payer,
  recipient,
  graph,
  version,
  receipt,
  artifacts,
  compiledTerms,
} from "./ui-fixtures";

const wallet = vi.hoisted(() => ({ connect: vi.fn(), sign: vi.fn() }));
vi.mock("@/components/deploy/wallet-kit", () => ({ getWalletKit: async () => ({}) }));
vi.mock("@/components/deploy/selected-wallet-connection", () => ({
  connectSelectedWallet: wallet.connect,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const key = instanceRecoveryKey(ownerId, "testnet", templateId);
let current: ReturnType<typeof receipt>;
let prepareBodies: unknown[];
let failPrepare: boolean;
let failSubmit: boolean;
let fetcher: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let reviewTerms = compiledTerms;
let initialReviewGraph = graph;
const bindings = () => ({
  version: 1 as const,
  templateVersionId: versionId,
  values: [{ inputId: "recipient", value: { type: "wallet" as const, value: recipient } }],
});
function marker(phase: InstanceRecovery["phase"] = "prepared"): InstanceRecovery {
  return {
    ownerId,
    templateId,
    versionId,
    network: "testnet",
    request: {
      sourceAccount: payer.publicKey(),
      idempotencyKey: "original-instance-key",
      bindings: bindings(),
    },
    graph,
    phase,
    receipt: current,
    ...(["signing", "submitted"].includes(phase)
      ? { attemptId: "55555555-5555-4555-8555-555555555555" }
      : {}),
  };
}
beforeEach(() => {
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.clearAllMocks();
  localStorage.clear();
  current = receipt();
  prepareBodies = [];
  failPrepare = false;
  failSubmit = false;
  reviewTerms = compiledTerms;
  initialReviewGraph = graph;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, _opts: unknown, fn: (lock: object) => Promise<void>) => fn({}),
    },
  });
  wallet.connect.mockResolvedValue({
    address: payer.publicKey(),
    walletId: "fixture",
    signTransaction: wallet.sign,
  });
  wallet.sign.mockImplementation(async (xdr: string) => {
    expect(readInstanceRecovery(key)?.phase).toBe("signing");
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
    return { signedTxXdr: tx.toXDR() };
  });
  fetcher = vi.fn(async (url, init) => {
    if (url.endsWith("/bindings"))
      return Response.json({ data: { graph, bindings: bindings(), artifacts } });
    if (url.endsWith("/prepare")) {
      const body: unknown = JSON.parse(String(init?.body));
      prepareBodies.push(body);
      expect(readInstanceRecovery(key)?.request).toEqual(body);
      if (failPrepare) throw new Error("network interrupted after admission");
      return Response.json({ data: current });
    }
    if (url.endsWith("/review"))
      return Response.json({
        data: {
          graph: initialReviewGraph,
          bindings: bindings(),
          artifacts,
          receipt: current,
          contentHash: "d".repeat(64),
          compiledTerms: reviewTerms,
        },
      });
    if (url.endsWith("/submit")) {
      expect(readInstanceRecovery(key)?.phase).toBe("submitted");
      const tx = TransactionBuilder.fromXDR(
        JSON.parse(String(init?.body)).signedXdr,
        Networks.TESTNET,
      ) as Transaction;
      expect(tx.hash().toString("hex")).toBe(current.txHash);
      expect(payer.verify(tx.hash(), tx.signatures[0]!.signature())).toBe(true);
      current = { ...current, status: "SUBMITTED", prepared: null };
      if (failSubmit) throw new Error("unknown submit response");
      return Response.json({ data: current });
    }
    if (url.includes("?limit="))
      return Response.json({ data: { items: [current], nextCursor: null } });
    return Response.json({ data: current });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function show(extra: Partial<Parameters<typeof InstanceForm>[0]> = {}) {
  return render(
    <InstanceForm
      ownerId={ownerId}
      username="Developer"
      network="testnet"
      templateId={templateId}
      version={version}
      retired={false}
      {...extra}
    />,
  );
}
async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  fireEvent.click(button);
}
async function reviewAndConnect() {
  fireEvent.change(screen.getByRole("textbox", { name: "Customer wallet (wallet)" }), {
    target: { value: recipient },
  });
  await click("Review bound terms");
  await screen.findByText("Bound initial terms");
  await click("Connect developer wallet");
  await screen.findByText(new RegExp(`Connected source / admin / fee payer: ${payer.publicKey()}`));
}

describe("private instance review, signing and recovery", () => {
  it.each(["schedule", "subscription"])(
    "shows actual compiled %s dates and full constant recipients before signing and after reload",
    async (kind) => {
      initialReviewGraph = FlowGraphSchema.parse({
        ...graph,
        nodes: [
          kind === "schedule"
            ? {
                id: "root",
                type: "on_schedule",
                config: {
                  startsAt: "2026-01-01T00:00:00Z",
                  intervalAmount: 1,
                  intervalUnit: "day",
                  occurrences: 2,
                },
              }
            : {
                id: "root",
                type: "subscription",
                config: {
                  asset: { kind: "native" },
                  subscriber: payer.publicKey(),
                  amountPerPeriodStroops: "100",
                  intervalAmount: 1,
                  intervalUnit: "day",
                  occurrences: 2,
                },
              },
          graph.nodes[1],
        ],
      });
      reviewTerms = InstanceCompiledTermsSchema.parse(
        flowToPipeline(initialReviewGraph, undefined, { ownerAddress: payer.publicKey() }),
      ).map((node) =>
        node.params.kind === "subscription_trigger"
          ? { ...node, params: { ...node.params, relayer: payer.publicKey() } }
          : node,
      );
      const timed = reviewTerms.find(
        (n) => n.params.kind === "streamer" || n.params.kind === "subscription_trigger",
      )!.params;
      if (timed.kind !== "streamer" && timed.kind !== "subscription_trigger")
        throw new Error("fixture");
      const expectedStart = new Date(timed.startTs * 1000).toISOString();
      const expectedEnd = new Date(timed.endTs * 1000).toISOString();
      const original = marker();
      original.request.bindings.values = [];
      original.graph = initialReviewGraph;
      writeInstanceRecovery(key, original);
      const v = {
        ...version,
        definition: { ...version.definition, graph: initialReviewGraph, inputs: [] },
      };
      const view = show({ version: v });
      await click("Load authoritative initial review");
      await screen.findByRole("heading", { name: "Admitted compiled contract terms" });
      expect(screen.getByText(new RegExp(expectedStart.replaceAll(".", "\\.")))).toBeTruthy();
      expect(screen.getByText(new RegExp(expectedEnd.replaceAll(".", "\\.")))).toBeTruthy();
      expect(screen.getByText("Payment interval (seconds)").nextElementSibling?.textContent).toBe(
        "86400",
      );
      expect(
        screen.getByText(
          kind === "schedule"
            ? "Recipients and allocations (full addresses)"
            : "Recipient (full address or pinned pipeline node)",
        ).nextElementSibling?.textContent,
      ).toContain(recipient);
      expect(document.body.textContent).not.toContain("2026-01-01");
      await click("Connect developer wallet");
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "Sign and submit reviewed instance" })
            .matches(":disabled"),
        ).toBe(false),
      );
      view.unmount();
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400000);
      try {
        show({ version: v });
        await click("Load authoritative initial review");
        await screen.findByRole("heading", { name: "Admitted compiled contract terms" });
        expect(screen.getByText(new RegExp(expectedStart.replaceAll(".", "\\.")))).toBeTruthy();
        expect(screen.getByText(new RegExp(expectedEnd.replaceAll(".", "\\.")))).toBeTruthy();
        expect(document.body.textContent).not.toContain("2026-01-01");
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("shows network/owner and refuses a missing required value without exemplar fallback", async () => {
    show();
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
    expect(screen.getByText(/Owner: Developer/)).toBeTruthy();
    await click("Review bound terms");
    await screen.findByRole("alert");
    expect(fetcher).not.toHaveBeenCalled();
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(
      (await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } }))
        .violations,
    ).toEqual([]);
  });
  it("saves the exact request before prepare and signs the source-signed exact body only once", async () => {
    show();
    await reviewAndConnect();
    await click("Prepare exact instance");
    await screen.findByText(/Estimated total deployment fee/);
    await click("Sign and submit reviewed instance");
    await waitFor(() => expect(readInstanceRecovery(key)?.phase).toBe("submitted"));
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(prepareBodies).toHaveLength(1);
    expect(localStorage.getItem(key)).not.toContain("signedXdr");
    expect(screen.queryByRole("button", { name: "Sign and submit reviewed instance" })).toBeNull();
    expect(screen.queryByText("View confirmed instance")).toBeNull();
    await click("Check original instance status");
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
  });
  it("retains original key/values across a lost prepare response and reload", async () => {
    failPrepare = true;
    const view = show();
    await reviewAndConnect();
    await click("Prepare exact instance");
    await screen.findByRole("alert");
    const original = readInstanceRecovery(key)!.request;
    expect(screen.queryByRole("button", { name: "Prepare exact instance" })).toBeNull();
    view.unmount();
    failPrepare = false;
    show();
    await click("Recover original preparation");
    await screen.findByRole("button", { name: "Load authoritative initial review" });
    expect(prepareBodies).toEqual([original, original]);
    expect(readInstanceRecovery(key)?.receipt?.deploymentId).toBe(instanceId);
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("treats unknown signing as reconciliation only, preserving marker and avoiding replacement", async () => {
    writeInstanceRecovery(key, marker());
    show();
    await click("Load authoritative initial review");
    await click("Connect developer wallet");
    wallet.sign.mockRejectedValue(new Error("wallet outcome unknown"));
    await click("Sign and submit reviewed instance");
    await screen.findByRole("alert");
    expect(readInstanceRecovery(key)?.phase).toBe("signing");
    expect(screen.queryByRole("button", { name: "Sign and submit reviewed instance" })).toBeNull();
    await click("Check original instance status");
    expect(readInstanceRecovery(key)?.phase).toBe("signing");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/submit"))).toBe(false);
    expect(screen.queryByRole("button", { name: /Start a separate/ })).toBeNull();
  });
  it("keeps unknown send state across reload and cannot retry signing or broadcasting", async () => {
    failSubmit = true;
    writeInstanceRecovery(key, marker());
    const view = show();
    await click("Load authoritative initial review");
    await click("Connect developer wallet");
    await click("Sign and submit reviewed instance");
    await screen.findByRole("alert");
    view.unmount();
    show();
    await click("Check original instance status");
    expect(readInstanceRecovery(key)?.phase).toBe("submitted");
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /Prepare exact|Sign and submit|Start a separate/ }),
    ).toBeNull();
  });
  it("ignores poisoned local graph and requires fresh server review after reload, including retired versions", async () => {
    const poisoned = structuredClone(graph);
    poisoned.nodes[1] = { ...poisoned.nodes[1]!, id: "poisoned" };
    writeInstanceRecovery(key, { ...marker(), graph: poisoned });
    show({ version: { ...version, retiredAt: new Date().toISOString() }, retired: true });
    expect(screen.queryByText("Original reviewed initial terms")).toBeNull();
    await click("Load authoritative initial review");
    await screen.findByText("Original reviewed initial terms");
    expect(document.body.textContent).not.toContain("poisoned");
    await click("Connect developer wallet");
    await click("Sign and submit reviewed instance");
    await waitFor(() => expect(wallet.sign).toHaveBeenCalledTimes(1));
  });
  it("rejects a different receipt identity before signing", async () => {
    writeInstanceRecovery(key, marker());
    show();
    current = { ...current, templateVersionId: "66666666-6666-4666-8666-666666666666" };
    await click("Load authoritative initial review");
    await screen.findByRole("alert");
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Sign and submit reviewed instance",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("blocks a stale reviewed envelope or source account before requesting a signature", async () => {
    writeInstanceRecovery(key, marker());
    show();
    await click("Load authoritative initial review");
    await click("Connect developer wallet");
    current = { ...current, prepared: { ...current.prepared!, feeStroops: "900" } };
    await click("Sign and submit reviewed instance");
    await screen.findByRole("alert");
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("observes cross-tab markers and locks out browsers without origin coordination", async () => {
    show();
    await reviewAndConnect();
    await act(async () => {
      writeInstanceRecovery(key, marker("signing"));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(screen.queryByRole("button", { name: "Prepare exact instance" })).toBeNull();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await click("Check original instance status");
    await screen.findByRole("alert");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/reconcile"))).toBe(false);
  });
  it("cannot sign recovery from a different selected version or clear finality based on local data", async () => {
    writeInstanceRecovery(key, {
      ...marker("final"),
      receipt: { ...current, status: "CONFIRMED", prepared: null },
    });
    show({ version: { ...version, id: "66666666-6666-4666-8666-666666666666", version: 2 } });
    expect(screen.queryByRole("button", { name: "Sign and submit reviewed instance" })).toBeNull();
    await click("Start a separate instance after final outcome");
    await screen.findByRole("alert");
    expect(readInstanceRecovery(key)).not.toBeNull();
  });
});
