import { describe, expect, it } from "vitest";
import {
  clampUnits,
  formatUnits,
  parseDraft,
  refusalNote,
  STROOP_DECIMALS,
} from "@/components/builder/inputs/numeric.utils";
import { I128_MAX } from "@/lib/flows/primitives";
import { formatStroops } from "@/lib/utils";

const units = (draft: string, decimals = STROOP_DECIMALS) => {
  const parsed = parseDraft(draft, decimals);
  if (parsed.kind !== "value") throw new Error(`${draft} parsed as ${parsed.kind}`);
  return parsed.units;
};

describe("parseDraft", () => {
  it.each([
    ["1.5", 15_000_000n],
    ["0.5", 5_000_000n],
    ["1.", 10_000_000n],
    [".5", 5_000_000n],
    ["00.10", 1_000_000n],
    [" 1.5 ", 15_000_000n],
    ["0.0000001", 1n],
    ["0", 0n],
  ])("reads %j as %s stroops", (draft, expected) => {
    expect(units(draft)).toBe(expected);
  });

  it("keeps the in-between states apart from a value", () => {
    expect(parseDraft("", 7)).toEqual({ kind: "empty" });
    expect(parseDraft("   ", 7)).toEqual({ kind: "empty" });
    expect(parseDraft(".", 7)).toEqual({ kind: "partial" });
  });

  it.each(["1,5", "1e7", "-1", "+1", "abc", "1.2.3", "0x10", "Infinity", "١٢", "1 000"])(
    "refuses %j rather than guessing",
    (draft) => {
      expect(parseDraft(draft, 7)).toEqual({ kind: "refused", reason: "shape" });
    },
  );

  it("refuses an 8th decimal instead of rounding it", () => {
    expect(parseDraft("0.00000001", 7)).toEqual({ kind: "refused", reason: "decimals" });
    expect(parseDraft("12.345", 2)).toEqual({ kind: "refused", reason: "decimals" });
    expect(parseDraft("1.5", 0)).toEqual({ kind: "refused", reason: "decimals" });
  });

  it("refuses more digits than an i128 has before BigInt sees them", () => {
    expect(units("9".repeat(39), 0)).toBe(10n ** 39n - 1n);
    expect(parseDraft("9".repeat(40), 0)).toEqual({ kind: "refused", reason: "length" });
    expect(parseDraft("9".repeat(1_000_000), 7)).toEqual({ kind: "refused", reason: "length" });
  });

  it("does no float arithmetic: 0.1 + 0.2 is exactly 0.3", () => {
    expect(units("0.1") + units("0.2")).toBe(units("0.3"));
    expect(units("0.3")).toBe(3_000_000n);
    expect(units("9007199254740993.0000001")).toBe(90071992547409930000001n);
  });

  it("reads percent at two decimals as basis points", () => {
    expect(units("12.5", 2)).toBe(1250n);
    expect(units("0.3", 2)).toBe(30n);
    expect(units("100", 2)).toBe(10_000n);
  });
});

describe("formatUnits", () => {
  it.each(["0", "1", "15000000", "10000001", "1234567890123", I128_MAX.toString()])(
    "round-trips %s stroops through formatStroops",
    (stroops) => {
      const text = formatUnits(BigInt(stroops), STROOP_DECIMALS);
      expect(text).toBe(formatStroops(stroops));
      expect(units(text)).toBe(BigInt(stroops));
    },
  );

  it("normalises trailing points and leading zeros", () => {
    expect(formatUnits(units("001.500"), 7)).toBe("1.5");
    expect(formatUnits(units("1."), 7)).toBe("1");
  });
});

describe("clampUnits", () => {
  it("passes a value in range and reports which bound a clamp hit", () => {
    expect(clampUnits(50n, 30n, 10_000n)).toEqual({ units: 50n, clamped: null });
    expect(clampUnits(10n, 30n, 10_000n)).toEqual({ units: 30n, clamped: "min" });
    expect(clampUnits(I128_MAX + 1n, 0n, I128_MAX)).toEqual({ units: I128_MAX, clamped: "max" });
  });
});

describe("refusalNote", () => {
  it("says what was wrong", () => {
    expect(refusalNote("decimals", 7)).toBe("At most 7 decimal places.");
    expect(refusalNote("decimals", 0)).toBe("Whole numbers only.");
    expect(refusalNote("shape", 7)).toMatch(/one decimal point/);
  });
});
