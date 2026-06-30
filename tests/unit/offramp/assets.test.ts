import { describe, expect, it, vi } from "vitest";
import { offRampAssetCode } from "@/lib/offramp/assets";

vi.mock("@/lib/env", () => ({
  env: vi.fn(() => ({
    OFFRAMP_ASSET_CODE: "USDC",
    OFFRAMP_NETWORK: "XLM_USDC_T_CEKS",
    OFFRAMP_CHANNEL: "InstaPay",
  })),
}));

describe("offRampAssetCode", () => {
  it("returns XLM for native asset", () => {
    expect(offRampAssetCode({ kind: "native" })).toBe("XLM");
  });

  it("returns USDC for known USDC asset", () => {
    expect(offRampAssetCode({ kind: "known", symbol: "USDC" })).toBe("USDC");
  });

  it("returns env override for custom assets", () => {
    expect(offRampAssetCode({ kind: "custom", code: "FOO", issuer: "GBAR" })).toBe("USDC");
  });
});
