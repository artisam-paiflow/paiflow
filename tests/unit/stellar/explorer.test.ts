import { describe, expect, it } from "vitest";
import {
  isStellarNetwork,
  stellarExpertContractUrl,
  type StellarNetwork,
} from "@/lib/stellar/explorer";

const CONTRACT = "CCJ6DMZG2O7VP6KYURP62L5NXW47GOHMXJDUP5T56DVHFAC7UDFSVYLA";

describe("stellarExpertContractUrl", () => {
  it("builds the testnet URL with the testnet segment", () => {
    expect(stellarExpertContractUrl(CONTRACT, "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
    );
  });

  it("builds the mainnet URL using the `public` segment", () => {
    expect(stellarExpertContractUrl(CONTRACT, "mainnet")).toBe(
      `https://stellar.expert/explorer/public/contract/${CONTRACT}`,
    );
  });
});

describe("isStellarNetwork", () => {
  it("accepts known networks", () => {
    expect(isStellarNetwork("testnet")).toBe(true);
    expect(isStellarNetwork("mainnet")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isStellarNetwork("public")).toBe(false);
    expect(isStellarNetwork("")).toBe(false);
    expect(isStellarNetwork(undefined)).toBe(false);
    expect(isStellarNetwork(null)).toBe(false);
  });

  it("narrows types when used as guard", () => {
    const v: unknown = "testnet";
    if (isStellarNetwork(v)) {
      const n: StellarNetwork = v;
      expect(n).toBe("testnet");
    }
  });
});
