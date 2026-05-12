import { describe, expect, it } from "vitest";
import { formatStroops, shortAddr } from "@/lib/utils";

describe("formatStroops", () => {
  it("formats whole units", () => {
    expect(formatStroops("10000000")).toBe("1");
    expect(formatStroops(20_000_000n)).toBe("2");
  });
  it("trims trailing zeros", () => {
    expect(formatStroops("12345670")).toBe("1.234567");
  });
  it("handles zero", () => {
    expect(formatStroops("0")).toBe("0");
  });
});

describe("shortAddr", () => {
  it("shortens long strings", () => {
    expect(shortAddr("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toMatch(/…/);
  });
  it("leaves short strings alone", () => {
    expect(shortAddr("abc")).toBe("abc");
  });
});
