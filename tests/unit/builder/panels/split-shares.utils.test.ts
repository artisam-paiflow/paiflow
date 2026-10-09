import { describe, expect, it } from "vitest";
import { defaultShares } from "@/components/builder/panels/split-shares.utils";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("defaultShares (#583)", () => {
  it("splits 100% evenly across recipients that never had a share", () => {
    expect(defaultShares([undefined])).toEqual([10_000]);
    expect(defaultShares([undefined, undefined])).toEqual([5000, 5000]);
    expect(defaultShares([undefined, undefined, undefined])).toEqual([3334, 3333, 3333]);
  });

  it("restores cached shares and gives the rest what they leave", () => {
    expect(defaultShares([6000, 4000])).toEqual([6000, 4000]);
    expect(defaultShares([6000, undefined, undefined])).toEqual([6000, 2000, 2000]);
  });

  it("never writes a negative or fractional share", () => {
    expect(defaultShares([10_000, undefined])).toEqual([10_000, 0]);
    expect(defaultShares([9000, 3000, undefined])).toEqual([9000, 3000, 0]);
    for (const n of [1, 3, 7, 9, 11]) {
      const shares = defaultShares(Array.from({ length: n }, () => undefined));
      expect(shares.every(Number.isInteger)).toBe(true);
      expect(sum(shares)).toBe(10_000);
    }
  });

  it("is empty for no recipients", () => {
    expect(defaultShares([])).toEqual([]);
  });
});
