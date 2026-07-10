import { describe, expect, it } from "vitest";
import {
  getPdaxAssetDecimals,
  pdaxQuantityToStellarStroops,
  stellarStroopsToPdaxQuantity,
} from "@/lib/offramp/pdax";

describe("getPdaxAssetDecimals", () => {
  it("returns 7 for XLM", () => {
    expect(getPdaxAssetDecimals("XLM")).toBe(7);
  });

  it("returns 6 for USDC", () => {
    expect(getPdaxAssetDecimals("USDC")).toBe(6);
  });

  it("defaults to 7 for unknown assets", () => {
    expect(getPdaxAssetDecimals("FOO")).toBe(7);
  });
});

describe("stellarStroopsToPdaxQuantity", () => {
  it("formats XLM with 7 decimal places", () => {
    expect(stellarStroopsToPdaxQuantity("10000000", "XLM")).toBe("1");
    expect(stellarStroopsToPdaxQuantity("12345678", "XLM")).toBe("1.2345678");
  });

  it("truncates USDC to 6 decimal places", () => {
    expect(stellarStroopsToPdaxQuantity("10000000", "USDC")).toBe("1");
    expect(stellarStroopsToPdaxQuantity("12345678", "USDC")).toBe("1.234567");
    // 1.2345000 USDC -> keep only significant digits after truncation.
    expect(stellarStroopsToPdaxQuantity("12345000", "USDC")).toBe("1.2345");
  });

  it("handles whole-unit amounts for USDC", () => {
    expect(stellarStroopsToPdaxQuantity("50000000", "USDC")).toBe("5");
  });

  it("handles sub-USDC-step amounts by truncating to zero fractional", () => {
    expect(stellarStroopsToPdaxQuantity("9", "USDC")).toBe("0");
  });
});

describe("pdaxQuantityToStellarStroops", () => {
  it("converts XLM quantity back to 7-decimal stroops", () => {
    expect(pdaxQuantityToStellarStroops("1", "XLM")).toBe("10000000");
    expect(pdaxQuantityToStellarStroops("1.2345678", "XLM")).toBe("12345678");
  });

  it("converts USDC quantity to 7-decimal Stellar stroops", () => {
    expect(pdaxQuantityToStellarStroops("1", "USDC")).toBe("10000000");
    expect(pdaxQuantityToStellarStroops("1.234568", "USDC")).toBe("12345680");
  });

  it("accepts numeric quantities", () => {
    expect(pdaxQuantityToStellarStroops(1.234568, "USDC")).toBe("12345680");
  });

  it("pads USDC quantities to 6 decimals before scaling to stroops", () => {
    expect(pdaxQuantityToStellarStroops("1.2", "USDC")).toBe("12000000");
  });
});
