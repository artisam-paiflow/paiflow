/**
 * Instawards D1 (#388): the address map that lets a revert deep in a swap
 * pipeline read as prose. The Soroswap factory entry is what turns a missing
 * pool from "error #205" into a sentence.
 */
import { Asset, Networks } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const FACTORY = "CDGXPBJPUBLIB4IMEIJXWUJXBLHVK6X33UAHIVLXPHMEGYCHZWLYBLQY";
const SWAPPER = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
const TRIGGER = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC = new Asset("USDC", USDC_ISSUER).contractId(Networks.TESTNET);
const XLM_SAC = Asset.native().contractId(Networks.TESTNET);
const ASSET_ENTRIES = { [USDC_SAC]: "stellar_asset", [XLM_SAC]: "stellar_asset" };

const stub = vi.hoisted(() => ({
  router: undefined as string | undefined,
  readFactory: vi.fn(async () => "" as string),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent", STELLAR_NETWORK: "testnet" }),
  soroswapRouterAddress: () => stub.router,
  stellarPassphrase: () => Networks.TESTNET,
}));
vi.mock("@/lib/stellar/soroswap", () => ({
  cachedSoroswapFactoryReader: () => stub.readFactory,
}));

import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";

const swapPipeline = [
  { contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
  { contractAddress: SWAPPER, templateKind: "SWAPPER" },
];

describe("buildPipelineErrorHint", () => {
  beforeEach(() => {
    stub.router = ROUTER;
    stub.readFactory.mockReset();
    stub.readFactory.mockResolvedValue(FACTORY);
  });

  it("maps pipeline contracts, the router and the Soroswap factory for a swap flow", async () => {
    const { addressMap } = await buildPipelineErrorHint(swapPipeline);
    expect(addressMap).toEqual({
      [TRIGGER]: "deposit_trigger",
      [SWAPPER]: "swapper",
      [ROUTER]: "soroswap_router",
      [FACTORY]: "soroswap_factory",
      ...ASSET_ENTRIES,
    });
    expect(stub.readFactory).toHaveBeenCalledWith(ROUTER);
  });

  it("does not look the factory up for a pipeline with no swap", async () => {
    const { addressMap } = await buildPipelineErrorHint([
      { contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
      { contractAddress: SWAPPER, templateKind: "PAYER" },
    ]);
    expect(stub.readFactory).not.toHaveBeenCalled();
    expect(addressMap[FACTORY]).toBeUndefined();
    expect(addressMap[ROUTER]).toBe("soroswap_router");
  });

  it("degrades to the rest of the map when the factory read fails", async () => {
    // This runs while building the hint for an error that already happened, so
    // throwing here would turn a readable revert into a 500.
    stub.readFactory.mockRejectedValue(new Error("rpc down"));
    const { addressMap } = await buildPipelineErrorHint(swapPipeline);
    expect(addressMap).toEqual({
      [TRIGGER]: "deposit_trigger",
      [SWAPPER]: "swapper",
      [ROUTER]: "soroswap_router",
      ...ASSET_ENTRIES,
    });
  });

  it("skips Soroswap entirely when the router env var is unset", async () => {
    stub.router = undefined;
    const { addressMap } = await buildPipelineErrorHint(swapPipeline);
    expect(stub.readFactory).not.toHaveBeenCalled();
    expect(addressMap).toEqual({
      [TRIGGER]: "deposit_trigger",
      [SWAPPER]: "swapper",
      ...ASSET_ENTRIES,
    });
  });

  it("names each builder asset by code and issuer, so a wrong-issuer trustline is visible (#574)", async () => {
    const { assetLabels } = await buildPipelineErrorHint(swapPipeline);
    expect(assetLabels).toEqual({
      [USDC_SAC]: `USDC issued by ${USDC_ISSUER}`,
      [XLM_SAC]: "XLM",
    });
  });

  it("returns an empty map for a non-pipeline deployment", async () => {
    stub.router = undefined;
    expect(await buildPipelineErrorHint(null)).toEqual({ addressMap: {} });
  });
});
