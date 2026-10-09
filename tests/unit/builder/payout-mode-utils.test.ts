import { describe, expect, it } from "vitest";
import {
  fiatPayoutAvailable,
  showPayoutModeSelect,
} from "@/components/builder/panels/payout-mode.utils";

describe("payout-mode.utils (#722)", () => {
  it("offers fiat on a receive flow only while the off-ramp is on", () => {
    expect(fiatPayoutAvailable(true, "on_receive", false)).toBe(true);
    expect(fiatPayoutAvailable(false, "on_receive", false)).toBe(false);
  });

  it("keeps the trigger and dev-mode rules when the off-ramp is on", () => {
    expect(fiatPayoutAvailable(true, "on_schedule", false)).toBe(false);
    expect(fiatPayoutAvailable(true, "on_receive", true)).toBe(false);
    expect(fiatPayoutAvailable(true, "payroll", true)).toBe(true);
    expect(fiatPayoutAvailable(true, null, false)).toBe(false);
  });

  it("never offers fiat on payroll either when the off-ramp is off", () => {
    expect(fiatPayoutAvailable(false, "payroll", true)).toBe(false);
  });

  it("keeps the selector on a step saved as fiat while the off-ramp is off, so it can go back to crypto", () => {
    expect(showPayoutModeSelect(false, false, "fiat")).toBe(true);
    expect(showPayoutModeSelect(false, false, "crypto")).toBe(false);
    expect(showPayoutModeSelect(false, false, undefined)).toBe(false);
  });

  it("does not show a selector the trigger does not allow just because the step is fiat", () => {
    expect(showPayoutModeSelect(false, true, "fiat")).toBe(false);
    expect(showPayoutModeSelect(true, true, undefined)).toBe(true);
  });
});
