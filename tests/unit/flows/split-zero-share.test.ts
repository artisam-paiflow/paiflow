/**
 * #583: a cleared or zero share is a draft the panel must be able to autosave,
 * so it parses under the shape schema, and `validateFlow` is what keeps it off
 * the chain.
 */
import { describe, expect, it } from "vitest";
import { FlowGraphSchema, FlowPatchSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ADDR_C = "GD6JP6TEQEWT3623BTELMLADR2FNBNF6AY62ZCT7T4DGBCPXPMPICVYR";
const USDC = { kind: "known", symbol: "USDC" } as const;

function splitFlow(recipients: unknown[]) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      { id: "s", type: "split", config: { asset: USDC, recipients } },
    ],
    edges: [{ id: "e1", source: "t", target: "s" }],
  };
}

function payFlow(config: Record<string, unknown>) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      { id: "p", type: "pay", config: { recipient: ADDR_A, asset: USDC, ...config } },
    ],
    edges: [{ id: "e1", source: "t", target: "p" }],
  };
}

const pct = (address: string, bps: number, label?: string) => ({
  address,
  mode: "percentage",
  bps,
  ...(label ? { label } : {}),
});

function errorsOf(graph: unknown) {
  const r = validateFlow(graph);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
}

describe("split share of 0 (#583)", () => {
  it("parses under FlowGraphSchema and FlowPatchSchema, so autosave does not 422", () => {
    const graph = splitFlow([pct(ADDR_A, 10_000), pct(ADDR_B, 0)]);
    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(FlowPatchSchema.safeParse({ graph }).success).toBe(true);
    expect(FlowPatchSchema.safeParse({ name: "x", graph }).success).toBe(true);
  });

  it("still refuses a share outside [0, 10000] or a fractional bps at parse time", () => {
    expect(FlowGraphSchema.safeParse(splitFlow([pct(ADDR_A, -1)])).success).toBe(false);
    expect(FlowGraphSchema.safeParse(splitFlow([pct(ADDR_A, 10_001)])).success).toBe(false);
    expect(FlowGraphSchema.safeParse(splitFlow([pct(ADDR_A, 12.5)])).success).toBe(false);
  });

  it("is refused by validateFlow on the recipients path, even when the rest sum to 100%", () => {
    const errors = errorsOf(
      splitFlow([pct(ADDR_A, 6000), pct(ADDR_B, 4000), pct(ADDR_C, 0, "Carol")]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("nodes.s.config.recipients");
    expect(errors[0]?.friendlyMessage).toBe(
      "Each recipient in a percentage split needs a share greater than 0%: Carol. Enter a share, or remove the recipient.",
    );
  });

  it("names every zero-share recipient, ahead of the sum error on the same path", () => {
    const errors = errorsOf(
      splitFlow([pct(ADDR_A, 5000), pct(ADDR_B, 0), pct(ADDR_C, 0, "Carol")]),
    );
    expect(errors.every((e) => e.path === "nodes.s.config.recipients")).toBe(true);
    // The panel shows the first message on a path; the specific one wins.
    expect(errors[0]?.friendlyMessage).toContain(`${ADDR_B}, Carol`);
    expect(errors[1]?.friendlyMessage).toMatch(/don't add up to 100%/);
  });

  it("refuses a lone recipient at 0", () => {
    const errors = errorsOf(splitFlow([pct(ADDR_A, 0)]));
    expect(errors.some((e) => /share greater than 0/.test(e.friendlyMessage))).toBe(true);
  });

  it("still accepts shares that are all positive and sum to 100%", () => {
    expect(validateFlow(splitFlow([pct(ADDR_A, 1250), pct(ADDR_B, 8750)])).ok).toBe(true);
  });

  it("refuses a zero share in a dev-mode split that has recipients", () => {
    const graph = {
      ...splitFlow([pct("PENDING:unnamed", 10_000), pct(ADDR_B, 0)]),
      devMode: true,
    };
    const errors = errorsOf(graph);
    expect(errors.some((e) => /share greater than 0/.test(e.friendlyMessage))).toBe(true);
  });

  it("accepts the recipient the dev-mode untick now writes (PENDING:, 100%)", () => {
    const graph = { ...splitFlow([pct("PENDING:unnamed", 10_000)]), devMode: true };
    expect(FlowPatchSchema.safeParse({ graph }).success).toBe(true);
    expect(validateFlow(graph).ok).toBe(true);
  });
});

describe("pay percentage / amount left empty (#583, same bug class)", () => {
  it("parses a pay at 0% or with no percentage yet, and validateFlow refuses it", () => {
    for (const config of [{ mode: "percentage", percentage: 0 }, { mode: "percentage" }]) {
      const graph = payFlow(config);
      expect(FlowPatchSchema.safeParse({ graph }).success).toBe(true);
      expect(errorsOf(graph).map((e) => e.path)).toContain("nodes.p.config.percentage");
    }
  });

  it("parses a pay whose fixed amount was cleared to 0, and validateFlow refuses it", () => {
    const graph = payFlow({ mode: "fixed", amountStroops: "0" });
    expect(FlowPatchSchema.safeParse({ graph }).success).toBe(true);
    expect(errorsOf(graph).map((e) => e.path)).toContain("nodes.p.config.amountStroops");
  });

  it("hydrates a legacy pay with no mode before parsing", () => {
    expect(FlowGraphSchema.parse(payFlow({ amountStroops: "10" })).nodes[1]?.config).toMatchObject({
      mode: "fixed",
    });
    expect(FlowGraphSchema.safeParse(payFlow({ fullAmount: true })).success).toBe(true);
  });
});
