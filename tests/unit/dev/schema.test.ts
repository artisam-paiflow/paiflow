import { describe, expect, it } from "vitest";
import { DevPayerSchema, DevSplitterSchema } from "@/lib/dev/schema";

const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
describe("shared dev request schemas (existing API behavior)", () => {
  it("accepts fixed amounts without losing precision", () => {
    const body = {
      nodeId: "pay",
      recipient: address,
      mode: "fixed",
      amountStroops: "90071992547409931234567",
    };
    expect(DevPayerSchema.parse(body)).toEqual(body);
  });
  it("accepts percentage and partial recipient-only updates", () => {
    expect(
      DevPayerSchema.parse({ recipient: address, mode: "percentage", percentage: 12.5 }).percentage,
    ).toBe(12.5);
    expect(DevPayerSchema.parse({ recipient: address })).toEqual({ recipient: address });
  });
  it.each([
    { recipient: "GBPARTIAL" },
    { amountStroops: 15 },
    { amountStroops: "1.5" },
    { amountStroops: "-1" },
    { mode: "fixed", amountStroops: "0" },
    { mode: "percentage", percentage: 0 },
    { mode: "percentage", percentage: 101 },
  ])("refuses invalid Pay values: %j", (body) => {
    expect(DevPayerSchema.safeParse(body).success).toBe(false);
  });
  it.each([
    { address, mode: "fixed", amountStroops: "15000000" },
    { address, mode: "percentage", bps: 10000 },
  ])("accepts a crypto Split and supplies its default payout mode", (recipient) => {
    expect(DevSplitterSchema.parse({ recipients: [recipient] }).recipients[0]).toEqual({
      ...recipient,
      payoutMode: "crypto",
    });
  });
  it.each([
    { mode: "fixed", amountStroops: "1" },
    { address: "Gpartial", mode: "fixed", amountStroops: "1" },
    { address, mode: "fixed", amountStroops: "0.5" },
    { address, mode: "percentage", bps: 0 },
    { address, mode: "percentage", bps: 10001 },
    { address, mode: "percentage", bps: 1.5 },
    { address, mode: "percentage" },
    { address, mode: "fixed" },
    { payoutMode: "fiat", mode: "fixed", amountStroops: "1" },
  ])("refuses invalid Split recipients: %j", (recipient) => {
    expect(DevSplitterSchema.safeParse({ recipients: [recipient] }).success).toBe(false);
  });
  it("bounds the roster to 1–20 recipients", () => {
    expect(DevSplitterSchema.safeParse({ recipients: [] }).success).toBe(false);
    expect(
      DevSplitterSchema.safeParse({
        recipients: Array.from({ length: 21 }, () => ({
          address,
          mode: "fixed",
          amountStroops: "1",
        })),
      }).success,
    ).toBe(false);
  });
});
