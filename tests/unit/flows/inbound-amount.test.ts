/**
 * The point of inboundRequirement is to decide when a trigger amount can be
 * locked, so the cases that matter are the ones where a fixed total stops
 * being knowable: a percentage anywhere in the chain, a swap changing the
 * denomination, or dev mode moving the amounts off the graph entirely.
 */
import { describe, expect, it } from "vitest";
import { inboundRequirement } from "@/lib/flows/inbound-amount";
import type { FlowGraph } from "@/lib/flows/schema";

const A = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const B = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const FIVE = "50000000";
const THREE = "30000000";

const trigger = (config: object = { asset: XLM }) => ({ id: "t", type: "on_receive", config });

const payFixed = (id: string, amountStroops: string, asset: object = XLM) => ({
  id,
  type: "pay",
  config: { recipient: A, asset, mode: "fixed", amountStroops, fullAmount: false },
});

const payPercent = (id: string, percentage: number) => ({
  id,
  type: "pay",
  config: { recipient: A, asset: XLM, mode: "percentage", percentage, fullAmount: false },
});

const splitFixed = (id: string) => ({
  id,
  type: "split",
  config: {
    asset: XLM,
    recipients: [
      { address: A, mode: "fixed", amountStroops: FIVE },
      { address: B, mode: "fixed", amountStroops: THREE },
    ],
  },
});

const splitPercent = (id: string) => ({
  id,
  type: "split",
  config: {
    asset: XLM,
    recipients: [
      { address: A, mode: "percentage", bps: 6000 },
      { address: B, mode: "percentage", bps: 4000 },
    ],
  },
});

const swap = (id: string) => ({
  id,
  type: "swap",
  config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
});

const graph = (nodes: unknown[], edges: [string, string][], extra: object = {}): FlowGraph =>
  ({
    nodes,
    edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
    ...extra,
  }) as FlowGraph;

const chain = (nodes: unknown[], extra: object = {}) =>
  graph(
    nodes,
    nodes
      .slice(1)
      .map((_, i) => [(nodes[i] as { id: string }).id, (nodes[i + 1] as { id: string }).id]),
    extra,
  );

describe("inboundRequirement", () => {
  it("locks a single fixed pay to its configured amount (the reported bug)", () => {
    expect(inboundRequirement(chain([trigger(), payFixed("p", FIVE)]))).toEqual({
      kind: "exact",
      stroops: FIVE,
      asset: XLM,
    });
  });

  it("sums a chain of fixed pays", () => {
    const r = inboundRequirement(chain([trigger(), payFixed("p1", FIVE), payFixed("p2", THREE)]));
    expect(r).toEqual({ kind: "exact", stroops: "80000000", asset: XLM });
  });

  it("sums an all-fixed split", () => {
    expect(inboundRequirement(chain([trigger(), splitFixed("s")]))).toEqual({
      kind: "exact",
      stroops: "80000000",
      asset: XLM,
    });
  });

  it("drops to a minimum when a percentage split absorbs the surplus", () => {
    expect(inboundRequirement(chain([trigger(), payFixed("p", FIVE), splitPercent("s")]))).toEqual({
      kind: "minimum",
      stroops: FIVE,
      asset: XLM,
    });
  });

  it("is variable when the only action takes a percentage", () => {
    expect(inboundRequirement(chain([trigger(), payPercent("p", 50)]))).toEqual({
      kind: "variable",
    });
  });

  it("is variable when the pay sends the full incoming amount", () => {
    const pay = {
      id: "p",
      type: "pay",
      config: { recipient: A, asset: XLM, fullAmount: true },
    };
    expect(inboundRequirement(chain([trigger(), pay]))).toEqual({ kind: "variable" });
  });

  it("does not add a fixed pay that sits downstream of a swap", () => {
    // The 10 USDC after the swap is not 10 XLM in, and how much XLM buys it
    // isn't knowable here.
    expect(
      inboundRequirement(chain([trigger(), swap("w"), payFixed("p", "100000000", USDC)])),
    ).toEqual({ kind: "variable" });
  });

  it("is variable behind a condition, which may block the flow entirely", () => {
    const condition = {
      id: "c",
      type: "condition",
      config: { kind: "amount_gt", amountStroops: FIVE },
    };
    expect(inboundRequirement(chain([trigger(), condition, payFixed("p", FIVE)]))).toEqual({
      kind: "variable",
    });
  });

  it("is variable in dev mode, where amounts are filled in after deploy", () => {
    expect(inboundRequirement(chain([trigger(), payFixed("p", FIVE)], { devMode: true }))).toEqual({
      kind: "variable",
    });
  });

  it("raises a minimum floor to the trigger's declared minimum", () => {
    const g = chain([
      trigger({ asset: XLM, minAmountStroops: "90000000" }),
      payFixed("p", FIVE),
      splitPercent("s"),
    ]);
    expect(inboundRequirement(g)).toEqual({
      kind: "minimum",
      stroops: "90000000",
      asset: XLM,
    });
  });

  it("does not let a smaller declared minimum lower the payout floor", () => {
    const g = chain([
      trigger({ asset: XLM, minAmountStroops: "10000000" }),
      payFixed("p", FIVE),
      splitPercent("s"),
    ]);
    expect(inboundRequirement(g)).toEqual({ kind: "minimum", stroops: FIVE, asset: XLM });
  });

  it("ignores an email_notify branch, which is never wired into the pipeline", () => {
    const email = { id: "m", type: "email_notify", config: { recipients: [{ email: "a@b.co" }] } };
    const g = graph(
      [trigger(), payFixed("p", FIVE), email],
      [
        ["t", "p"],
        ["p", "m"],
      ],
    );
    expect(inboundRequirement(g)).toEqual({ kind: "exact", stroops: FIVE, asset: XLM });
  });

  it("refuses to lock when the trigger minimum exceeds what the chain consumes", () => {
    // The splitter enforces min_amount on chain, so locking to 5 would always
    // revert, and any amount that passed would strand the difference.
    const g = chain([trigger({ asset: XLM, minAmountStroops: "90000000" }), payFixed("p", FIVE)]);
    expect(inboundRequirement(g)).toEqual({ kind: "variable" });
  });

  it("ignores a trigger minimum below what the chain consumes", () => {
    const g = chain([trigger({ asset: XLM, minAmountStroops: "10000000" }), payFixed("p", FIVE)]);
    expect(inboundRequirement(g)).toEqual({ kind: "exact", stroops: FIVE, asset: XLM });
  });

  it("is variable when the chain branches, which the contracts wire inconsistently", () => {
    // A payer forwards its remainder to next_steps[0] only, while a deposit
    // trigger sends the full amount to every step — a total across both
    // branches would be a guess.
    const g = graph(
      [trigger(), payFixed("p1", FIVE), payFixed("p2", THREE)],
      [
        ["t", "p1"],
        ["t", "p2"],
      ],
    );
    expect(inboundRequirement(g)).toEqual({ kind: "variable" });
  });

  it.each(["subscription", "payroll", "on_schedule", "oracle", "webhook"])(
    "is variable for a %s trigger, which the relayer drives rather than a sender",
    (type) => {
      const g = chain([{ id: "t", type, config: { asset: XLM } }, payFixed("p", FIVE)]);
      expect(inboundRequirement(g)).toEqual({ kind: "variable" });
    },
  );

  it("is variable without a trigger", () => {
    expect(inboundRequirement(graph([payFixed("p", FIVE)], []))).toEqual({ kind: "variable" });
  });
});
