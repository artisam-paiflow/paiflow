import { describe, expect, it } from "vitest";
import {
  TtlFeeEventSchema,
  TtlFeeInputSchema,
  reconcileTtlFees,
  type TtlFeeEvent,
} from "@/lib/stellar/ttl-fee-measurements";

describe("TTL fee evidence", () => {
  it("accepts a realistic public rent transaction input", () => {
    expect(
      TtlFeeInputSchema.safeParse({
        transactions: [
          {
            label: "webhook actual-code TTL extension",
            hash: "5b3f0b9471034111999368bf790c75705f3f9c939ac2bb60faa927af3bb0a9c2",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { transactions: [] },
    { transactions: [{ label: "", hash: "ab".repeat(32) }] },
    { transactions: [{ label: "restoration", hash: "not-a-hash" }] },
    { transactions: [{ label: "restoration", hash: 123 }] },
    {
      transactions: Array.from({ length: 101 }, () => ({
        label: "restoration",
        hash: "ab".repeat(32),
      })),
    },
  ])("rejects malformed or unbounded transaction evidence %j", (input) => {
    expect(TtlFeeInputSchema.safeParse(input).success).toBe(false);
  });

  it("confirms the net fee without subtracting an already-accounted refund again", () => {
    expect(
      reconcileTtlFees(
        [
          { stage: "before", amountStroops: "255250597" },
          { stage: "after", amountStroops: "-33301142" },
        ],
        "255250597",
        "221949455",
      ),
    ).toMatchObject({ refundStroops: "33301142", netFeeStroops: "221949455" });
  });

  it("supports a charged inclusion fee below its declaration and a zero refund", () => {
    expect(
      reconcileTtlFees([{ stage: "before", amountStroops: "100" }], "200", "100").netFeeStroops,
    ).toBe("100");
  });

  it("keeps values beyond number precision exact and sums multiple refunds", () => {
    expect(
      reconcileTtlFees(
        [
          { stage: "after", amountStroops: "-1" },
          { stage: "before", amountStroops: "9007199254740995" },
          { stage: "after", amountStroops: "-2" },
        ],
        "9007199254740995",
        "9007199254740992",
      ).netFeeStroops,
    ).toBe("9007199254740992");
  });

  const invalidCases: TtlFeeEvent[][] = [
    [],
    [{ stage: "after", amountStroops: "-1" }],
    [
      { stage: "before", amountStroops: "100" },
      { stage: "before", amountStroops: "100" },
    ],
    [{ stage: "before", amountStroops: "-100" }],
    [
      { stage: "before", amountStroops: "100" },
      { stage: "after", amountStroops: "1" },
    ],
    [
      { stage: "before", amountStroops: "100" },
      { stage: "after", amountStroops: "-101" },
    ],
  ];
  it.each(invalidCases.map((events) => ({ events })))(
    "rejects incomplete or impossible accounting: $events",
    ({ events }) => {
      expect(() => reconcileTtlFees(events, "100", "100")).toThrow();
    },
  );

  it("rejects result mismatches and charges above the envelope cap", () => {
    const events = [{ stage: "before" as const, amountStroops: "100" }];
    expect(() => reconcileTtlFees(events, "100", "90")).toThrow();
    expect(() => reconcileTtlFees(events, "99", "100")).toThrow();
  });

  it.each(["0", "100", "-33301142"])("accepts integer stroops %s", (amountStroops) => {
    expect(TtlFeeEventSchema.safeParse({ stage: "after", amountStroops }).success).toBe(true);
  });

  it.each([1, "1.5", "1e7", "01", "NaN", "", null])(
    "rejects non-integer or non-string stroops %j",
    (amountStroops) => {
      expect(TtlFeeEventSchema.safeParse({ stage: "before", amountStroops }).success).toBe(false);
    },
  );
});
