import { describe, expect, it, vi } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { constructorArgs, pipelineNodeConstructorArgs } from "@/lib/stellar/scval";

vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: vi.fn(() => "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
}));

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("constructorArgs", () => {
  describe("splitter recipients encoding", () => {
    it("encodes recipients as ScVal scvVec of scvMap entries with address/bps keys", () => {
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
        const inner = entry.value() as xdr.ScMapEntry[];
        expect(inner).toHaveLength(2);
        expect(inner[0]!.key()).toEqual(nativeToScVal("address", { type: "symbol" }));
        expect(inner[1]!.key()).toEqual(nativeToScVal("bps", { type: "symbol" }));
      }
    });
  });
});

describe("pipelineNodeConstructorArgs", () => {
  it("encodes deposit_trigger with next steps", () => {
    const args = pipelineNodeConstructorArgs(
      {
        kind: "deposit_trigger",
        asset: { kind: "native" },
        nextStepNodeIds: ["action"],
      },
      ADDR,
      undefined,
      { action: ADDR2 },
    );
    expect(args).toHaveLength(3);
    expect(args[0]!).toEqual(new Address(ADDR).toScVal());
    expect(args[2]!.switch()).toBe(xdr.ScValType.scvVec());
  });

  it("encodes splitter with parent", () => {
    const args = pipelineNodeConstructorArgs(
      {
        kind: "splitter",
        asset: { kind: "native" },
        recipients: [{ address: ADDR, bps: 10_000 }],
        minAmountStroops: "100",
      },
      ADDR,
      ADDR2,
      {},
    );
    expect(args).toHaveLength(5);
    expect(args[4]!).toEqual(new Address(ADDR2).toScVal());
  });

  it("encodes timelock with unlock time and next steps", () => {
    const args = pipelineNodeConstructorArgs(
      {
        kind: "timelock",
        asset: { kind: "native" },
        unlockTime: 1_000_000,
        nextStepNodeIds: ["splitter"],
      },
      ADDR,
      ADDR2,
      { splitter: ADDR },
    );
    expect(args).toHaveLength(5);
  });

  it("encodes router with threshold and paths", () => {
    const args = pipelineNodeConstructorArgs(
      {
        kind: "router",
        asset: { kind: "native" },
        threshold: "500",
        pathANodeIds: ["a"],
        pathBNodeIds: ["b"],
      },
      ADDR,
      ADDR2,
      { a: ADDR, b: ADDR2 },
    );
    expect(args).toHaveLength(6);
  });

  it("encodes conditional with condition and next steps", () => {
    const args = pipelineNodeConstructorArgs(
      {
        kind: "conditional",
        asset: { kind: "native" },
        recipients: [{ address: ADDR, bps: 10_000 }],
        amountStroops: "1000",
        condition: { kind: "time_after", at: "2030-01-01T00:00:00.000Z" },
        nextStepNodeIds: [],
      },
      ADDR,
      ADDR2,
      {},
    );
    expect(args).toHaveLength(7);
  });

  it("throws when parent is missing for a child node", () => {
    expect(() =>
      pipelineNodeConstructorArgs(
        {
          kind: "splitter",
          asset: { kind: "native" },
          recipients: [{ address: ADDR, bps: 10_000 }],
          minAmountStroops: "0",
        },
        ADDR,
        undefined,
        {},
      ),
    ).toThrow("Splitter requires a parent address");
  });
});
