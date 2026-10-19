import { describe, expect, it } from "vitest";
import { ExecutePrepareSchema, PayoutPrepareSchema } from "@/lib/api/v1/schema";
import { I128_MAX } from "@/lib/flows/primitives";

const from = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// Payout preparation inherits the execute amount constraint before any relayer mutation.
for (const [name, schema, extra] of [
  ["execute", ExecutePrepareSchema, {}],
  ["payout", PayoutPrepareSchema, { recipient: from }],
] as const) {
  describe(`${name} preparation amount`, () => {
    it.each([
      "1",
      "0001",
      "10000000",
      "9007199254740993",
      (I128_MAX - 1n).toString(),
      I128_MAX.toString(),
    ])("preserves a positive representable integer string: %s", (amount) => {
      expect(schema.parse({ from, amount, ...extra }).amount).toBe(amount);
    });

    it.each([(I128_MAX + 1n).toString(), "9".repeat(39)])(
      "rejects overflow with a field-level range error: %s",
      (amount) => {
        const result = schema.safeParse({ from, amount, ...extra });
        expect(result.success).toBe(false);
        expect(result.error?.issues).toEqual([
          expect.objectContaining({
            path: ["amount"],
            message: "Amount exceeds the contract i128 range",
          }),
        ]);
      },
    );

    it.each(["", "-1", "+1", "1.5", "1e7", " 1", "1 ", "١", "9".repeat(40), "9".repeat(10_000)])(
      "rejects malformed strings without throwing during validation: %.40s",
      (amount) => {
        const result = schema.safeParse({ from, amount, ...extra });
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.message)).toEqual([
          "Must be a whole number of stroops",
        ]);
      },
    );

    it.each(["0", "000"])("retains the positivity error for %s", (amount) => {
      const result = schema.safeParse({ from, amount, ...extra });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "Must be greater than zero",
      ]);
    });

    it.each([1, 1n, null, undefined, {}, []])("rejects non-string amount %s", (amount) => {
      expect(schema.safeParse({ from, amount, ...extra }).success).toBe(false);
    });
  });
}
