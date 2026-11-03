import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrKey } from "@stellar/stellar-sdk";
import CompiledTerms from "@/components/flow-templates/compiled-terms";
import { InstancePreparedTermsSchema } from "@/lib/flow-instances/compiled-review-schema";
import { compiledTerms, payer, recipient } from "./ui-fixtures";

const router = StrKey.encodeContract(Buffer.alloc(32, 9));
describe("final prepared authority/routing review", () => {
  it("requires final external bindings and displays complete router and relayer addresses", () => {
    const base = {
      ...compiledTerms[0]!,
      nodeId: "swap",
      templateKind: "SWAPPER",
      params: {
        kind: "swapper",
        assetIn: { kind: "native" },
        assetOut: { kind: "known", symbol: "USDC" },
        slippageBps: 100,
        deadlineSecs: 300,
        nextStepNodeIds: [],
      },
    };
    expect(InstancePreparedTermsSchema.safeParse([base]).success).toBe(false);
    const lock = {
      ...compiledTerms[0]!,
      nodeId: "lock",
      templateKind: "TIMELOCK",
      params: {
        kind: "timelock",
        asset: { kind: "native" },
        unlockTime: 1893456000,
        mode: "after",
        nextStepNodeIds: [],
      },
    };
    expect(InstancePreparedTermsSchema.safeParse([lock]).success).toBe(false);
    const terms = InstancePreparedTermsSchema.parse([
      { ...base, params: { ...base.params, router } },
      { ...lock, params: { ...lock.params, relayer: payer.publicKey() } },
    ]);
    render(<CompiledTerms terms={terms} />);
    expect(screen.getByText("Swap router (full address)").nextElementSibling?.textContent).toBe(
      router,
    );
    expect(screen.getByText("Relayer (full address)").nextElementSibling?.textContent).toBe(
      payer.publicKey(),
    );
    expect(screen.getByText(/verified against the exact saved unsigned transaction/)).toBeTruthy();
    expect(
      InstancePreparedTermsSchema.safeParse([
        { ...base, params: { ...base.params, router: recipient } },
      ]).success,
    ).toBe(false);
  });
});
