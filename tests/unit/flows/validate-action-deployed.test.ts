/**
 * A contract action the user drew must appear in the pipeline that gets
 * deployed. Both the template ladder in validate.ts and flowToPipeline pick
 * "the" action as contractActions[0] — node array order, i.e. the order blocks
 * were added to the canvas, not the order money moves. A flow drawn
 * trigger -> swap -> pay whose pay block was added first therefore used to
 * validate as a plain payer pipeline with the swap silently dropped, and would
 * have deployed a payer paying an asset the flow never acquired.
 */
import { describe, expect, it } from "vitest";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";

const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const swap = {
  id: "s",
  type: "swap",
  config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
};
const pay = {
  id: "p",
  type: "pay",
  config: {
    recipient: ACCOUNT,
    asset: USDC,
    mode: "fixed",
    amountStroops: "1000000",
    fullAmount: true,
  },
};
const edges = [
  { id: "e1", source: "t", target: "s" },
  { id: "e2", source: "s", target: "p" },
];
const onReceive = { id: "t", type: "on_receive", config: { asset: XLM } };
const payroll = {
  id: "t",
  type: "payroll",
  config: {
    asset: XLM,
    employer: ACCOUNT,
    intervalAmount: 1,
    intervalUnit: "week",
    fillScheduleViaApi: false,
  },
};

describe("every contract action reaches the deployed pipeline", () => {
  it("deploys the swapper when the blocks were added in flow order", () => {
    const v = validateFlow({ nodes: [onReceive, swap, pay], edges } as never);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(flowToPipeline(v.graph).map((n) => n.templateKind)).toContain("SWAPPER");
  });

  it("refuses a receive flow whose pay block was added before its swap", () => {
    const v = validateFlow({ nodes: [onReceive, pay, swap], edges } as never);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => /wouldn't reach the chain/.test(e.friendlyMessage))).toBe(true);
  });

  it("refuses a payroll flow carrying a swap the payroll pipeline can't deploy", () => {
    const v = validateFlow({ nodes: [payroll, pay, swap], edges } as never);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => /wouldn't reach the chain/.test(e.friendlyMessage))).toBe(true);
  });
});
