import { describe, expect, it } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";

const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const asset = { kind: "native" };
const trigger = { id: "t", type: "on_receive", config: { asset } };
const graph = (action: unknown) =>
  FlowGraphSchema.parse({
    devMode: true,
    nodes: [trigger, action],
    edges: [{ id: "e", source: "t", target: "a" }],
  });

describe("standard configuration after mutable-flow removal (#1138)", () => {
  it("discards retired configuration flags without supplying payment values", () => {
    const g = graph({
      id: "a",
      type: "pay",
      config: { asset, recipient: address, fillValueViaApi: true },
    });
    expect(g).not.toHaveProperty("devMode");
    expect(g.nodes[1]?.config).not.toHaveProperty("fillValueViaApi");
    expect(g.nodes[1]?.config).not.toHaveProperty("amountStroops");
    const result = validateFlow(g, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path.endsWith("amountStroops"))).toBe(true);
  });
  it("requires recipients before an empty split can deploy", () => {
    const g = graph({ id: "a", type: "split", config: { asset, recipients: [] } });
    const result = validateFlow(g, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path.endsWith("recipients"))).toBe(true);
  });
  it("compiles complete inputs only to standard contracts despite retired input flags", () => {
    const g = graph({
      id: "a",
      type: "pay",
      config: {
        asset,
        recipient: address,
        mode: "fixed",
        amountStroops: "1234567890123456789",
        fillValueViaApi: true,
      },
    });
    expect(validateFlow(g, { ignoreOwnerEmail: true }).ok).toBe(true);
    expect(flowToPipeline(g).map((n) => n.templateKind)).toEqual(["DEPOSIT_TRIGGER", "PAYER"]);
    expect(flowToPipeline(g)[1]?.params).toMatchObject({
      recipient: address,
      amountStroops: "1234567890123456789",
    });
  });
});

describe("immutable payroll fiat bank configuration", () => {
  const bank = { accountName: "Recipient", accountNumber: "1234567890", bankCode: "BASECPH" };
  function payroll(details: Partial<typeof bank>) {
    return FlowGraphSchema.parse({
      senderKyc: {
        firstName: "Owner",
        lastName: "Example",
        countryOrigin: "Philippines",
        sourceOfFunds: "Compensation",
      },
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            employer: address,
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
              {
                address: "PENDING:salary",
                mode: "fixed",
                amountStroops: "1000000000",
                payoutMode: "fiat",
                ...details,
              },
            ],
          },
        },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
  }
  it.each(["accountName", "accountNumber", "bankCode"] as const)(
    "refuses a missing or whitespace %s at that recipient field",
    (field) => {
      for (const value of [undefined, "", "  "]) {
        const result = validateFlow(payroll({ ...bank, [field]: value }), {
          ignoreOwnerEmail: true,
        });
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(result.errors).toEqual([
            expect.objectContaining({
              path: `nodes.a.config.recipients.0.${field}`,
              message: expect.stringContaining("Fiat recipient is missing"),
            }),
          ]);
      }
    },
  );
  it("compiles a complete bank destination into immutable CASH_OUT constructor values", () => {
    const g = payroll(bank);
    const result = validateFlow(g, { ignoreOwnerEmail: true });
    expect(result.ok).toBe(true);
    const pipeline = flowToPipeline(g);
    expect(pipeline.map((n) => n.templateKind)).toEqual(["SUBSCRIPTION", "SPLITTER", "CASH_OUT"]);
    expect(pipeline[2]?.params).toMatchObject({ kind: "cash_out", ...bank });
  });
});
