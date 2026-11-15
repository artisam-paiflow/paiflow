import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { Account, Contract, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import ConditionalHostedPaymentReview from "@/components/deploy/conditional-hosted-payment-review";
import HostedExecutionPanel from "@/components/deploy/hosted-execution-panel";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptanceIntent,
} from "@/tests/fixtures/conditional-v2-acceptance";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import { conditionalHostedPaymentReview } from "@/lib/hosted-execution/conditional-review";
vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("conditional payment review and owner opt-in", () => {
  it("displays actual route/post-prefix amount, full owner and both branch terms with exact-hash acknowledgement", () => {
    const definition = conditionalAcceptanceDefinition(),
      execution = conditionalAcceptanceIntent(definition, "109");
    const tx = new TransactionBuilder(new Account(execution.payer, "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(execution.rootContract).call("execute_v2", ...executionV2Args(execution)),
      )
      .setTimeout(180)
      .build();
    const prepared = {
      version: 2 as const,
      prepared: {
        intent: "12281228-1228-4228-8228-122812281228",
        txHash: tx.hash().toString("hex"),
        walletAddress: execution.payer,
        xdr: tx.toXDR(),
        expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
        network: "testnet" as const,
        networkPassphrase: Networks.TESTNET,
        execution,
      },
      feeStroops: tx.fee,
      ...conditionalHostedPaymentReview(execution),
    };
    const ack = vi.fn();
    render(
      <ConditionalHostedPaymentReview
        prepared={prepared}
        acknowledged={false}
        onAcknowledge={ack}
        disabled={false}
      />,
    );
    expect(screen.getByText(/actual original payment selects False/).textContent).toContain(
      execution.amountAtConditionStroops,
    );
    expect(screen.getByText(/Immutable deployment owner:/).textContent).toContain(definition.owner);
    expect(screen.getByText(/Original transaction:/).textContent).toContain(
      prepared.prepared.txHash,
    );
    expect(screen.getByText(/True terminal:/)).toBeTruthy();
    expect(screen.getByText(/Receive at least/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(ack).toHaveBeenCalledWith(true);
  });
  it("selects version2 for enable and disable and retains the trigger link", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({ data: { enabled: JSON.parse(String(init?.body)).enabled } }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <HostedExecutionPanel
        deploymentId="12281228-1228-4228-8228-122812281228"
        initialEnabled={false}
        conditional
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enable payment form" }));
    await screen.findByRole("link", { name: "Open payment form" });
    expect(fetcher.mock.calls[0]![0]).toContain("?version=2");
    fireEvent.click(screen.getByRole("button", { name: "Disable payment form" }));
    await screen.findByRole("button", { name: "Enable payment form" });
    expect(fetcher.mock.calls[1]![0]).toContain("?version=2");
    expect(screen.queryByRole("link", { name: "Open payment form" })).toBeNull();
  });
});
