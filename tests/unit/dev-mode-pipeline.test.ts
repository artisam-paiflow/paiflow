import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { flowToPipeline } from "@/lib/flows/to-params";
import { FlowGraphSchema } from "@/lib/flows/schema";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const RELAYER = "GDRELAYER7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5XYZ";
const PENDING = "PENDING:alice";
const CASHOUT_ADDR = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

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

  it("maps cash_out -> CASH_OUT_DEV terminal sink with treasury", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "100", label: "A" }],
          },
        },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "native" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    });
    const pipeline = flowToPipeline(graph, RELAYER, ADDR_B);
    const cashOut = pipeline.find((n) => n.nodeId === "c")!;
    expect(cashOut.templateKind).toBe(TemplateKind.CASH_OUT_DEV);
    expect(cashOut.params.kind).toBe("cash_out_dev");
    if (cashOut.params.kind === "cash_out_dev") {
      expect(cashOut.params.treasury).toBe(ADDR_B);
      expect(cashOut.params.relayer).toBe(RELAYER);
      expect(cashOut.params.nextStepNodeIds).toHaveLength(0);
      expect(cashOut.params.bankCode).toBe("BASECPH");
    }
  });

  it("leaves cash_out bank fields blank when empty in dev mode", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "native" },
            accountName: "",
            accountNumber: "",
            bankCode: "",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "c" }],
    });
    const cashOut = flowToPipeline(graph, RELAYER).find((n) => n.nodeId === "c")!;
    if (cashOut.params.kind === "cash_out_dev") {
      expect(cashOut.params.accountName).toBe("");
      expect(cashOut.params.accountNumber).toBe("");
      expect(cashOut.params.bankCode).toBe("");
    } else {
      throw new Error("expected cash_out_dev");
    }
  });

  it("maps cash_out -> CASH_OUT in non-dev mode with bank details", () => {
    const graph = parse({
      devMode: false,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "c",
          type: "cash_out",
          config: {
            asset: { kind: "native" },
            accountName: "Juan",
            accountNumber: "123",
            bankCode: "BASECPH",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "c" }],
    });
    const pipeline = flowToPipeline(graph, RELAYER, ADDR_B);
    const cashOut = pipeline.find((n) => n.nodeId === "c")!;
    expect(cashOut.templateKind).toBe(TemplateKind.CASH_OUT);
    expect(cashOut.params.kind).toBe("cash_out");
    if (cashOut.params.kind === "cash_out") {
      expect(cashOut.params.treasury).toBe(ADDR_B);
      expect(cashOut.params.relayer).toBe(RELAYER);
      expect(cashOut.params.nextStepNodeIds).toHaveLength(0);
      expect(cashOut.params.bankCode).toBe("BASECPH");
    } else {
      throw new Error("expected cash_out");
    }
  });

  it("maps payroll dev split fiat recipients to CASH_OUT_DEV terminals", () => {
    const graph = parse({
      devMode: true,
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: ADDR_B,
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "100", payoutMode: "crypto" },
              {
                address: CASHOUT_ADDR,
                mode: "fixed",
                amountStroops: "200",
                payoutMode: "fiat",
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    const pipeline = flowToPipeline(graph, RELAYER, ADDR_B);

    const sub = pipeline.find((n) => n.nodeId === "t")!;
    expect(sub.templateKind).toBe(TemplateKind.SUBSCRIPTION_DEV);

    const split = pipeline.find((n) => n.nodeId === "a")!;
    expect(split.templateKind).toBe(TemplateKind.SPLITTER_DEV);
    if (split.params.kind === "splitter_dev") {
      expect(split.params.recipients).toHaveLength(2);
      const crypto = split.params.recipients.find((r) => r.address === ADDR_A);
      const fiat = split.params.recipients.find((r) => r.address !== ADDR_A);
      expect(crypto?.isCashOut).toBe(false);
      expect(fiat?.isCashOut).toBe(true);
      expect(fiat?.amount).toBe("200");
    } else {
      throw new Error("expected splitter_dev");
    }

    const cashOut = pipeline.find((n) => n.templateKind === TemplateKind.CASH_OUT_DEV);
    expect(cashOut).toBeDefined();
    expect(cashOut!.nodeId).toMatch(/^a-cashout-/);
    if (cashOut!.params.kind === "cash_out_dev") {
      expect(cashOut!.params.parentNodeId).toBe(split.nodeId);
      expect(cashOut!.params.treasury).toBe(ADDR_B);
    }
  });
});
