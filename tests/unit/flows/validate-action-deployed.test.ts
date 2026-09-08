/**
 * A contract action the user drew must appear in the pipeline that gets
 * deployed. Both the template ladder in validate.ts and flowToPipeline pick
 * "the" action as contractActions[0] — node array order, i.e. the order blocks
 * were added to the canvas, not the order money moves. A flow drawn
 * trigger -> swap -> pay whose pay block was added first therefore used to
 * validate as a plain payer pipeline with the swap silently dropped, and would
 * have deployed a payer paying an asset the flow never acquired.
 *
 * "Not emitted" is not the same as "lost", though: an oracle_gte condition
 * compiles to a CONDITIONAL that owns the recipients and pays them itself, so
 * its pay or split is absorbed on purpose and must still validate. A swap has
 * no recipients for the CONDITIONAL to carry, so it is lost rather than
 * absorbed and must not.
 */
import { describe, expect, it } from "vitest";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";

const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
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
const onSchedule = {
  id: "t",
  type: "on_schedule",
  config: {
    asset: XLM,
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    intervalAmount: 1,
    intervalUnit: "day",
    amountPerIntervalStroops: "10000000",
  },
};
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

  it("refuses a schedule flow whose second chained pay the streamer would drop", () => {
    // The streamer carries one payout step, taken from contractActions[0]; the
    // second pay reaches no contract at all, so that recipient is never paid.
    const v = validateFlow({
      nodes: [onSchedule, pay, { ...pay, id: "p2" }],
      edges: [
        { id: "e1", source: "t", target: "p" },
        { id: "e2", source: "p", target: "p2" },
      ],
    } as never);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => /wouldn't reach the chain/.test(e.friendlyMessage))).toBe(true);
  });
});

describe("actions a conditional absorbs on purpose still validate", () => {
  // An oracle_gte condition sets `terminal` in flowToPipeline: the CONDITIONAL
  // node owns the recipients and pays them, so the pay/split node is never
  // emitted. That is by design, not a dropped step.
  const oracle = {
    id: "c",
    type: "condition",
    config: { kind: "oracle_gte", oracle: ACCOUNT, key: "XLMUSD", threshold: "100" },
  };
  const condEdges = [
    { id: "e1", source: "t", target: "c" },
    { id: "e2", source: "c", target: "p" },
  ];

  it("accepts receive -> oracle_gte -> pay", () => {
    const v = validateFlow({
      nodes: [onReceive, oracle, { ...pay, config: { ...pay.config, asset: XLM } }],
      edges: condEdges,
    } as never);
    expect(v.ok, v.ok ? "" : JSON.stringify(v.errors)).toBe(true);
  });

  it("accepts receive -> oracle_gte -> split", () => {
    const split = {
      id: "p",
      type: "split",
      config: {
        asset: XLM,
        recipients: [
          { address: ACCOUNT, mode: "percentage", bps: 5000, label: "A" },
          { address: OTHER, mode: "percentage", bps: 5000, label: "B" },
        ],
      },
    };
    const v = validateFlow({ nodes: [onReceive, oracle, split], edges: condEdges } as never);
    expect(v.ok, v.ok ? "" : JSON.stringify(v.errors)).toBe(true);
  });

  it("still refuses a swap under an oracle_gte condition, which has no recipients to absorb it", () => {
    const v = validateFlow({
      nodes: [onReceive, oracle, swap, { ...pay, id: "p2" }],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "s" },
        { id: "e3", source: "s", target: "p2" },
      ],
    } as never);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => /wouldn't reach the chain/.test(e.friendlyMessage))).toBe(true);
  });
});
