import { describe, expect, it } from "vitest";
import { requirePayConsumesAll, splitPayoutRemainder } from "@/lib/api/v1/payout-money";
import {
  PayoutPrepareSchema,
  PayoutPreparedSchema,
  PayoutSubmitSchema,
  PayoutSubmittedSchema,
} from "@/lib/api/v1/schema";
const FROM = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
describe("payout money and boundaries", () => {
  it("preserves fixed cap semantics below and at the cap", () => {
    for (const amount of ["1", "100", "9007199254740993"])
      expect(() =>
        requirePayConsumesAll(amount, { amountStroops: "9007199254740993", percentageBps: 0 }),
      ).not.toThrow();
  });
  it("refuses fixed surplus and percentage rounding leftovers", () => {
    expect(() => requirePayConsumesAll("101", { amountStroops: "100", percentageBps: 0 })).toThrow(
      /leave funds/,
    );
    expect(() => requirePayConsumesAll("1", { amountStroops: "0", percentageBps: 9999 })).toThrow(
      /leave funds/,
    );
  });
  it("uses bigint above Number precision and guards the contract multiplication", () => {
    expect(() =>
      requirePayConsumesAll("9007199254740993", { amountStroops: "0", percentageBps: 10000 }),
    ).not.toThrow();
    expect(() =>
      requirePayConsumesAll(((1n << 127n) - 1n).toString(), {
        amountStroops: "0",
        percentageBps: 10000,
      }),
    ).toThrow(/i128/);
  });
  it("only forwards positive fixed surplus from an empty Split", () => {
    expect(splitPayoutRemainder("9007199254740993", "100", "0", "0")).toBe("9007199254740893");
    for (const amount of ["99", "100"])
      expect(() => splitPayoutRemainder(amount, "100", "0", "0")).toThrow(/does not reach/);
    expect(() => splitPayoutRemainder("101", "0", "0", "0")).toThrow(/percentage/);
    expect(() => splitPayoutRemainder("101", "100", "1", "0")).toThrow(/pooled/);
    expect(() => splitPayoutRemainder("101", "100", "0", "1")).toThrow(/pooled/);
  });
  it("round trips requests and responses", () => {
    expect(PayoutPrepareSchema.parse({ from: FROM, amount: "1", recipient: FROM })).toEqual({
      from: FROM,
      amount: "1",
      recipient: FROM,
    });
    expect(
      PayoutPreparedSchema.parse({
        xdr: "xdr",
        nodeId: "p",
        network: "testnet",
        networkPassphrase: "test",
        expiresAt: "2030-01-01T00:00:00Z",
      }).nodeId,
    ).toBe("p");
    expect(PayoutSubmitSchema.parse({ signedXdr: "a".repeat(10) }).signedXdr).toHaveLength(10);
    expect(PayoutSubmittedSchema.parse({ txHash: "hash", status: "PENDING" }).status).toBe(
      "PENDING",
    );
  });
  it.each(["0", "-1", "1.2", "NaN", "1e7", (1n << 127n).toString(), "9".repeat(40)])(
    "rejects amount %s without throwing BigInt errors",
    (amount) => {
      expect(PayoutPrepareSchema.safeParse({ from: FROM, amount, recipient: FROM }).success).toBe(
        false,
      );
    },
  );
  it("refuses contract recipients, extra fields, and empty node IDs", () => {
    for (const extra of [
      { recipient: "C".repeat(56) },
      { secretKey: "never accepted" },
      { nodeId: "" },
    ])
      expect(
        PayoutPrepareSchema.safeParse({ from: FROM, amount: "1", recipient: FROM, ...extra })
          .success,
      ).toBe(false);
  });
});
