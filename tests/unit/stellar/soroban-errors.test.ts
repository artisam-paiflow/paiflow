import { describe, expect, it } from "vitest";
import {
  contractKeyForParamsKind,
  contractKeyForTemplate,
  translateSorobanError,
} from "@/lib/stellar/soroban-errors";

// Realistic dump for a streamer constructor rejecting end_ts <= start_ts.
const STREAMER_BAD_WINDOW_DUMP =
  "HostError: Error(Context, InvalidAction) Event log (newest first): " +
  "0: [Diagnostic Event] contract:CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW, " +
  'topics:[error, Error(Contract, 4)], data:"escalating error to VM trap from failed host function call: create_contract_with_constructor"';

describe("translateSorobanError", () => {
  it("translates a contract error via the contract hint", () => {
    const t = translateSorobanError(STREAMER_BAD_WINDOW_DUMP, { contract: "streamer" });
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("BadWindow");
    expect(t.friendly).toMatch(/end time must be after the start time/i);
    expect(t.friendly).not.toMatch(/HostError|Diagnostic Event/);
  });

  it("resolves the failing contract via the address map (pipeline deploys)", () => {
    const address = "CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    const t = translateSorobanError(STREAMER_BAD_WINDOW_DUMP, {
      addressMap: { [address]: "streamer" },
    });
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("BadWindow");
  });

  it("prefers the address map over the contract hint", () => {
    const address = "CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    const t = translateSorobanError(STREAMER_BAD_WINDOW_DUMP, {
      contract: "splitter",
      addressMap: { [address]: "streamer" },
    });
    expect(t.errorName).toBe("BadWindow");
  });

  it("returns a numbered fallback when the contract is unknown", () => {
    const t = translateSorobanError(STREAMER_BAD_WINDOW_DUMP);
    expect(t.matched).toBe(false);
    expect(t.friendly).toMatch(/error #4/);
    expect(t.friendly).not.toMatch(/HostError|Diagnostic Event/);
  });

  it("maps host-level failures", () => {
    expect(translateSorobanError("HostError: Error(Storage, ExceededLimit)").friendly).toMatch(
      /resource limits/i,
    );
    expect(
      translateSorobanError("simulation failed: insufficient balance for fee").friendly,
    ).toMatch(/[Ii]nsufficient balance/);
    expect(translateSorobanError("Error: live_until is greater than max").friendly).toMatch(
      /expiration/i,
    );
  });

  it("falls back to a generic message for unrecognized dumps", () => {
    const t = translateSorobanError("something completely unexpected happened");
    expect(t.matched).toBe(false);
    expect(t.friendly).toMatch(/pre-flight simulation/i);
  });

  it("translates invoke-time contract errors (subscription NotYetDue)", () => {
    const raw =
      "0: [Diagnostic Event] contract:CC5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVA, topics:[error, Error(Contract, 5)]";
    const t = translateSorobanError(raw, { contract: "subscription" });
    expect(t.errorName).toBe("NotYetDue");
    expect(t.friendly).toMatch(/isn't due yet/i);
  });
});

describe("Stellar Asset Contract errors on the payout leg (#574)", () => {
  const TRIGGER = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";
  const SWAPPER = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
  const PAYER = "CBWGUCYLFBALLEC6GPSJBPSRYVLLBHCC7DEQJIB2T2TG4INW4AQ5LI7M";
  const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
  const LABEL = "USDC issued by GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  // Newest first, as the host logs it: the trigger, swapper and payer each trap
  // with the #13 the asset contract raised, and the asset contract comes last.
  const frame = (address: string) =>
    `[Diagnostic Event] contract:${address}, topics:[error, Error(Contract, #13)], data:"escalating error to VM trap"`;
  const DUMP =
    "HostError: Error(Contract, #13) Event log (newest first): " +
    [TRIGGER, SWAPPER, PAYER, USDC_SAC].map((a, i) => `${i}: ${frame(a)}`).join(" ");

  const hint = {
    addressMap: {
      [TRIGGER]: "deposit_trigger",
      [SWAPPER]: "swapper",
      [PAYER]: "payer",
      [USDC_SAC]: "stellar_asset",
    } as const,
    assetLabels: { [USDC_SAC]: LABEL },
  };

  it("names the asset and its issuer instead of 'error #13'", () => {
    const t = translateSorobanError(DUMP, hint);
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("TrustlineMissingError");
    expect(t.friendly).toContain("trustline");
    expect(t.friendly).toContain(LABEL);
    expect(t.friendly).not.toMatch(/error #13|\{asset\}/);
  });

  it("says 'this asset' when the asset contract has no label", () => {
    const t = translateSorobanError(DUMP, { addressMap: hint.addressMap });
    expect(t.friendly).toMatch(/no trustline for this asset/);
  });

  it("does not read the re-raised #13 in the payer's or swapper's table", () => {
    // Without the asset contract mapped, the outer frames are re-raises of the
    // same code and must not be explained by their own tables.
    const { [USDC_SAC]: _, ...withoutAsset } = hint.addressMap;
    const t = translateSorobanError(DUMP, { addressMap: withoutAsset });
    expect(t.matched).toBe(false);
    expect(t.friendly).toMatch(/error #13/);
  });
});

describe("contract key mappings", () => {
  it("maps template kinds", () => {
    expect(contractKeyForTemplate("STREAMER")).toBe("streamer");
    expect(contractKeyForTemplate("SPLITTER_DEV")).toBe("splitter_dev");
    expect(contractKeyForTemplate("CASH_OUT")).toBe("cash_out");
    expect(contractKeyForTemplate("FACTORY")).toBeUndefined();
  });

  it("maps params kinds", () => {
    expect(contractKeyForParamsKind("streamer")).toBe("streamer");
    expect(contractKeyForParamsKind("webhook_trigger")).toBe("webhook");
    expect(contractKeyForParamsKind("subscription_dev_trigger")).toBe("subscription_dev");
    expect(contractKeyForParamsKind("payroll_trigger")).toBe("payroll");
  });
});
