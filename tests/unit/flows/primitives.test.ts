import { describe, expect, it } from "vitest";
import { I128_MAX, stroopsSchema } from "@/lib/flows/primitives";

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
