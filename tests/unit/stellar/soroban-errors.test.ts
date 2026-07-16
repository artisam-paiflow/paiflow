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
