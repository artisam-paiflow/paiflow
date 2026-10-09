import { describe, expect, it } from "vitest";
import { paymentAmountIssues, scheduledPaymentIssues } from "@/lib/flows/payment-bounds";
import { I128_MAX } from "@/lib/flows/primitives";
import { FlowGraphSchema, FlowPatchSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";

const A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const asset = { kind: "known", symbol: "USDC" };
const tooLarge = (I128_MAX + 1n).toString();

type DraftGraph = {
  nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

function payGraph(amount: string, scheduled = false, occurrences = 1): DraftGraph {
  return {
    nodes: [
      scheduled
        ? {
            id: "t",
            type: "on_schedule",
            config: {
              intervalAmount: 1,
              intervalUnit: "hour",
              startsAt: "2030-01-01T00:00:00.000Z",
              occurrences,
            },
          }
        : { id: "t", type: "on_receive", config: { asset } },
      {
        id: "p",
        type: "pay",
        config: { asset, recipient: A, mode: "fixed", amountStroops: amount },
      },
    ],
    edges: [{ id: "e", source: "t", target: "p" }],
  };
}

function splitGraph(amounts: string[]): DraftGraph {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset } },
      {
        id: "s",
        type: "split",
        config: {
          asset,
          recipients: amounts.map((amountStroops, i) => ({
            address: i === 0 ? A : B,
            mode: "fixed",
            amountStroops,
          })),
        },
      },
    ],
    edges: [{ id: "e", source: "t", target: "s" }],
  };
}

function errors(graph: unknown) {
  const result = validateFlow(graph);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("standard payment deployment bounds (#795)", () => {
  it("leaves incomplete and out-of-range amounts saveable, then reports deployment field errors", () => {
    for (const amount of ["0", "00", tooLarge, "9".repeat(500)]) {
      const graph = payGraph(amount);
      expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
      expect(FlowPatchSchema.safeParse({ graph }).success).toBe(true);
      expect(errors(graph).some((e) => e.path === "nodes.p.config.amountStroops")).toBe(true);
    }
  });

  it("accepts the maximum fixed Pay amount and rejects one stroop beyond it", () => {
    expect(validateFlow(payGraph(I128_MAX.toString())).ok).toBe(true);
    expect(errors(payGraph(tooLarge)).map((e) => e.path)).toContain("nodes.p.config.amountStroops");
  });

  it("rejects a fixed recipient total overflow even though each amount fits", () => {
    expect(errors(splitGraph([I128_MAX.toString(), "1"])).map((e) => e.path)).toContain(
      "nodes.s.config.recipients",
    );
    expect(validateFlow(splitGraph([(I128_MAX - 1n).toString(), "1"])).ok).toBe(true);
  });

  it("reports individual out-of-range fixed recipients", () => {
    expect(errors(splitGraph([tooLarge, "1"])).map((e) => e.path)).toContain(
      "nodes.s.config.recipients.0.amountStroops",
    );
  });

  it("reports an out-of-range Receive minimum on its field", () => {
    const graph = splitGraph(["1"]);
    Object.assign(graph.nodes[0]!.config, { minAmountStroops: tooLarge });
    expect(errors(graph).map((e) => e.path)).toContain("nodes.t.config.minAmountStroops");
  });

  it("checks subscription pull amounts but ignores a stale manual amount for a fixed split", () => {
    const graph = payGraph("1");
    graph.nodes[0] = {
      id: "t",
      type: "subscription",
      config: {
        asset,
        subscriber: A,
        amountPerPeriodStroops: tooLarge,
        intervalAmount: 1,
        intervalUnit: "hour",
        occurrences: 1,
      },
    };
    expect(errors(graph).map((e) => e.path)).toContain("nodes.t.config.amountPerPeriodStroops");
    const split = splitGraph(["1", "2"]);
    split.nodes[0] = graph.nodes[0]!;
    expect(validateFlow(split).ok).toBe(true);
  });

  it("rejects fixed zero recipients with leading zeros", () => {
    expect(errors(splitGraph(["00", "1"])).some((e) => /must be positive/.test(e.message))).toBe(
      true,
    );
  });

  it("checks the maximum scheduled payout using the compiler's occurrences", () => {
    expect(validateFlow(payGraph(I128_MAX.toString(), true, 1)).ok).toBe(true);
    expect(
      errors(payGraph(I128_MAX.toString(), true, 2)).some((e) =>
        /Maximum scheduled payout/.test(e.message),
      ),
    ).toBe(true);
    expect(validateFlow(payGraph((I128_MAX / 2n).toString(), true, 2)).ok).toBe(true);
  });

  it("checks the default thirty-day window too", () => {
    const graph = payGraph(I128_MAX.toString(), true);
    delete graph.nodes[0]!.config.occurrences;
    expect(errors(graph).some((e) => /Maximum scheduled payout/.test(e.message))).toBe(true);
  });

  it("rejects a zero amount actually consumed by the standard streamer", () => {
    const graph = payGraph("00", true);
    Object.assign(graph.nodes[1]!.config, { mode: "percentage", percentage: 50 });
    expect(
      errors(graph).some((e) => /Scheduled payment amount must be greater/.test(e.message)),
    ).toBe(true);
  });

  it("matches constructor flooring for a schedule ending partway through an interval", () => {
    const graph = payGraph(I128_MAX.toString(), true);
    graph.nodes[0]!.config = {
      intervalAmount: 1,
      intervalUnit: "hour",
      startsAt: "2030-01-01T00:00:00.000Z",
      endsAt: "2030-01-01T01:59:59.000Z",
    };
    expect(validateFlow(graph).ok).toBe(true);
  });

  it("keeps deferred mutable values compatible", () => {
    const graph = { ...payGraph(tooLarge), devMode: true };
    Object.assign(graph.nodes[1]!.config, { fillValueViaApi: true });
    expect(validateFlow(graph).ok).toBe(true);
    expect(paymentAmountIssues(FlowGraphSchema.parse(graph))).toEqual([]);
  });

  it("checks the standard streamer even when dev mode is enabled", () => {
    expect(
      errors({ ...payGraph(I128_MAX.toString(), true, 2), devMode: true }).some((e) =>
        /Maximum scheduled payout/.test(e.message),
      ),
    ).toBe(true);
  });

  it("ignores a stale fixed value when full-amount Pay compiles to a percentage", () => {
    const graph = payGraph(tooLarge);
    Object.assign(graph.nodes[1]!.config, { fullAmount: true });
    expect(validateFlow(graph).ok).toBe(true);
  });

  it("validates scheduled fixed sums and ignores stale per-interval values", () => {
    const graph = splitGraph([(I128_MAX - 1n).toString(), "1"]);
    graph.nodes[0] = payGraph("1", true).nodes[0]!;
    Object.assign(graph.nodes[1]!.config, { amountPerIntervalStroops: tooLarge });
    expect(validateFlow(graph).ok).toBe(true);
    const pipeline = flowToPipeline(FlowGraphSchema.parse(graph));
    expect(scheduledPaymentIssues(pipeline)).toEqual([]);
  });

  it("checks derived legacy rates rather than just the raw rate", () => {
    const graph = splitGraph([]);
    graph.nodes[0] = payGraph("1", true).nodes[0]!;
    Object.assign(graph.nodes[1]!.config, {
      recipients: [{ address: A, mode: "percentage", bps: 10_000 }],
      ratePerSecondStroops: I128_MAX.toString(),
    });
    const pipeline = flowToPipeline(FlowGraphSchema.parse(graph));
    expect(scheduledPaymentIssues(pipeline).map((e) => e.path)).toEqual(["nodes.s.config"]);
  });
});
