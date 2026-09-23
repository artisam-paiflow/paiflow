import { describe, expect, it } from "vitest";
import { bpsSchema, I128_MAX, stroopsSchema, TOTAL_BPS } from "@/lib/flows/primitives";
import { TOTAL_BPS as SCHEMA_TOTAL_BPS } from "@/lib/flows/schema";

const MESSAGE = "caller's own wording";
const schema = stroopsSchema({ message: MESSAGE });

describe("stroopsSchema", () => {
  it.each(["1", "10000000", I128_MAX.toString()])("accepts %s", (s) => {
    expect(schema.parse(s)).toBe(s);
  });

  it.each([
    ["zero", "0"],
    ["zero with leading zeros", "000"],
    ["one past i128", (I128_MAX + 1n).toString()],
    ["40 digits", "1".repeat(40)],
    ["10k digits", "9".repeat(10_000)],
    ["a decimal", "1.5"],
    ["a negative", "-1"],
    ["an exponent", "1e7"],
    ["padding", " 1"],
    ["empty", ""],
    ["non-ASCII digits", "١"],
  ])("refuses %s with the caller's message", (_label, s) => {
    const r = schema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([MESSAGE]);
  });

  it.each([1, 1n, null, undefined])("refuses the non-string %s", (v) => {
    expect(schema.safeParse(v).success).toBe(false);
  });
});

describe("bpsSchema", () => {
  it.each([0, 30, TOTAL_BPS])("accepts %s", (n) => {
    expect(bpsSchema().parse(n)).toBe(n);
  });

  it.each([-1, TOTAL_BPS + 1, 1.5, Number.NaN])("refuses %s", (n) => {
    expect(bpsSchema().safeParse(n).success).toBe(false);
  });

  it("coerces a query string only when asked", () => {
    expect(bpsSchema().safeParse("250").success).toBe(false);
    expect(bpsSchema({ coerce: true }).parse("250")).toBe(250);
    expect(bpsSchema({ coerce: true }).safeParse("10001").success).toBe(false);
  });

  it("leaves the default to the caller", () => {
    expect(bpsSchema().default(100).parse(undefined)).toBe(100);
  });

  it("is the one TOTAL_BPS the flow schema re-exports", () => {
    expect(SCHEMA_TOTAL_BPS).toBe(TOTAL_BPS);
  });
});
