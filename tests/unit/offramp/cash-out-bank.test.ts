import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { bankDetailsFromGraph, eventCreatesOffRampJob } from "@/lib/offramp/cash-out-bank";
import type { FlowGraph } from "@/lib/flows/schema";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function graph(nodes: Array<Record<string, unknown>>): FlowGraph {
  return { nodes, edges: [] } as unknown as FlowGraph;
}

describe("bankDetailsFromGraph", () => {
  it("reads bank details from an explicit cash_out graph node", () => {
    const g = graph([
      {
        id: "co",
        type: "cash_out",
        config: {
          asset: { kind: "native" },
          accountName: "Alice",
          accountNumber: "111",
          bankCode: "BASECPH",
        },
      },
    ]);
    expect(bankDetailsFromGraph(g, "co")).toEqual({
      accountName: "Alice",
      accountNumber: "111",
      bankCode: "BASECPH",
    });
  });

  it("resolves a generated terminal from the parent fiat pay node", () => {
    const g = graph([
      {
        id: "a",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: ADDR,
          payoutMode: "fiat",
          accountName: "Bob",
          accountNumber: "222",
          bankCode: "BASECPH",
        },
      },
    ]);
    expect(bankDetailsFromGraph(g, "a-cashout-0")).toEqual({
      accountName: "Bob",
      accountNumber: "222",
      bankCode: "BASECPH",
    });
  });

  it("resolves a generated terminal from the parent split node's fiat recipient", () => {
    const g = graph([
      {
        id: "s",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            { address: ADDR, mode: "percentage", bps: 6000, payoutMode: "crypto" },
            {
              address: ADDR,
              mode: "percentage",
              bps: 4000,
              payoutMode: "fiat",
              accountName: "Carol",
              accountNumber: "333",
              bankCode: "BASECPH",
            },
          ],
        },
      },
    ]);
    expect(bankDetailsFromGraph(g, "s-cashout-1")).toEqual({
      accountName: "Carol",
      accountNumber: "333",
      bankCode: "BASECPH",
    });
  });

  it("returns null for a generated terminal whose parent recipient is crypto", () => {
    const g = graph([
      {
        id: "s",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [{ address: ADDR, mode: "percentage", bps: 10000, payoutMode: "crypto" }],
        },
      },
    ]);
    expect(bankDetailsFromGraph(g, "s-cashout-0")).toBeNull();
  });

  it("returns null when the parent node is missing", () => {
    const g = graph([{ id: "t", type: "on_receive", config: { asset: { kind: "native" } } }]);
    expect(bankDetailsFromGraph(g, "nope-cashout-0")).toBeNull();
  });

  it("returns null for non-cash-out node ids", () => {
    const g = graph([
      {
        id: "a",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: ADDR, payoutMode: "crypto" },
      },
    ]);
    expect(bankDetailsFromGraph(g, "a")).toBeNull();
  });
});

describe("eventCreatesOffRampJob", () => {
  it("skips payroll deployments (cron owns their jobs)", () => {
    expect(eventCreatesOffRampJob(TemplateKind.PAYROLL)).toBe(false);
  });

  it("allows all other flow templates", () => {
    for (const kind of [
      TemplateKind.SPLITTER,
      TemplateKind.PAYER,
      TemplateKind.DEPOSIT_TRIGGER,
      TemplateKind.WEBHOOK,
      TemplateKind.SUBSCRIPTION,
      TemplateKind.ORACLE,
      TemplateKind.PAYER_DEV,
      TemplateKind.SPLITTER_DEV,
      TemplateKind.SUBSCRIPTION_DEV,
    ]) {
      expect(eventCreatesOffRampJob(kind)).toBe(true);
    }
  });
});
