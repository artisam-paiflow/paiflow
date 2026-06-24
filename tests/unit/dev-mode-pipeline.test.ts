import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { flowToPipeline } from "@/lib/flows/to-params";
import { FlowGraphSchema } from "@/lib/flows/schema";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const RELAYER = "GDRELAYER7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5XYZ";
const PENDING = "PENDING:alice";

function parse(graph: unknown) {
  return FlowGraphSchema.parse(graph);
}

describe("dev-mode pipeline resolver", () => {
  it("maps pay -> PAYER_DEV when devMode is on", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "100",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const pipeline = flowToPipeline(graph, RELAYER);
    const payer = pipeline.find((n) => n.nodeId === "a")!;
    expect(payer.templateKind).toBe(TemplateKind.PAYER_DEV);
    expect(payer.params.kind).toBe("payer_dev");
    if (payer.params.kind === "payer_dev") {
      expect(payer.params.recipient).toBe(ADDR_A);
      expect(payer.params.relayer).toBe(RELAYER);
    }
  });

  it("leaves recipient blank when pending in dev mode", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: PENDING,
            mode: "fixed",
            amountStroops: "100",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const payer = flowToPipeline(graph, RELAYER).find((n) => n.nodeId === "a")!;
    if (payer.params.kind === "payer_dev") {
      expect(payer.params.recipient).toBeUndefined();
    } else {
      throw new Error("expected payer_dev");
    }
  });

  it("maps split -> SPLITTER_DEV and drops pending recipients", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "100", label: "A" },
              { address: PENDING, mode: "fixed", amountStroops: "50", label: "pending" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const split = flowToPipeline(graph, RELAYER).find((n) => n.nodeId === "a");
    expect(split).toBeDefined();
    expect(split!.templateKind).toBe(TemplateKind.SPLITTER_DEV);
    if (split!.params.kind === "splitter_dev") {
      expect(split!.params.recipients).toHaveLength(1);
      expect(split!.params.recipients[0]!.address).toBe(ADDR_A);
      expect(split!.params.relayer).toBe(RELAYER);
    } else {
      throw new Error("expected splitter_dev");
    }
  });

  it("maps subscription -> SUBSCRIPTION_DEV and keeps concrete subscriber", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: { kind: "native" },
            subscriber: ADDR_B,
            amountPerPeriodStroops: "1000",
            intervalAmount: 1,
            intervalUnit: "day",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "100",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const pipeline = flowToPipeline(graph, RELAYER);
    const sub = pipeline.find((n) => n.nodeId === "t")!;
    expect(sub.templateKind).toBe(TemplateKind.SUBSCRIPTION_DEV);
    if (sub.params.kind === "subscription_dev_trigger") {
      expect(sub.params.subscriber).toBe(ADDR_B);
      expect(sub.params.relayer).toBe(RELAYER);
    } else {
      throw new Error("expected subscription_dev_trigger");
    }
    // Downstream action also becomes a dev variant.
    const payer = pipeline.find((n) => n.nodeId === "a")!;
    expect(payer.templateKind).toBe(TemplateKind.PAYER_DEV);
  });

  it("keeps immutable kinds when devMode is off", () => {
    const graph = parse({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "100",
            fullAmount: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const payer = flowToPipeline(graph, RELAYER).find((n) => n.nodeId === "a")!;
    expect(payer.templateKind).toBe(TemplateKind.PAYER);
  });
});
