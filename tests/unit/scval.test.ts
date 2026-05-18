import { describe, expect, it, vi } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { constructorArgs } from "@/lib/stellar/scval";

vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: vi.fn(() => "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
}));

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("constructorArgs", () => {
  describe("splitter recipients encoding", () => {
    it("encodes recipients as ScVal scvVec of scvMap with symbol keys", () => {
      const args = constructorArgs(
        {
          kind: "splitter",
          asset: { kind: "known", symbol: "USDC" },
          recipients: [
            { address: ADDR, bps: 6000 },
            { address: ADDR, bps: 4000 },
          ],
        },
        ADDR,
      );

      const recipientsScVal = args[2]!;
      expect(recipientsScVal.switch()).toBe(xdr.ScValType.scvVec());

      const vec = recipientsScVal.value() as xdr.ScVal[];
      expect(vec).toHaveLength(2);

      for (const entry of vec) {
        expect(entry.switch()).toBe(xdr.ScValType.scvMap());
        const map = entry.value() as xdr.ScMapEntry[];
        const keys = map.map((e: xdr.ScMapEntry) => e.key().sym().toString());
        expect(keys).toContain("address");
        expect(keys).toContain("bps");
      }
    });

    it("keys are in lexicographic Symbol order (address before bps)", () => {
      const args = constructorArgs(
        {
          kind: "splitter",
          asset: { kind: "known", symbol: "USDC" },
          recipients: [{ address: ADDR, bps: 10000 }],
        },
        ADDR,
      );

      const recipientsScVal = args[2]!;
      const vec = recipientsScVal.value() as xdr.ScVal[];
      const map = vec[0]!.value() as xdr.ScMapEntry[];
      const keys = map.map((e: xdr.ScMapEntry) => e.key().sym().toString());

      expect(keys[0]).toBe("address");
      expect(keys[1]).toBe("bps");
    });
  });
});
