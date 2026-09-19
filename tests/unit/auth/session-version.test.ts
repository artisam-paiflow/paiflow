/**
 * The rule that ends a stateless session (#519). getSessionUser() in
 * lib/auth.ts applies it on every request, and that module cannot be loaded
 * under vitest, so this file is the only place the rule is exercised.
 */
import { describe, it, expect } from "vitest";
import { isSessionCurrent } from "@/lib/auth/session-version";

const active = (sessionVersion: number) => ({ isActive: true, sessionVersion });

describe("isSessionCurrent", () => {
  it("accepts a token whose version matches the row", () => {
    expect(isSessionCurrent({ sessionVersion: 0 }, active(0))).toBe(true);
    expect(isSessionCurrent({ sessionVersion: 3 }, active(3))).toBe(true);
  });

  // Every session alive at deploy time was minted without the claim. Reading
  // "absent" as anything but the column default would sign the whole user base
  // out at once.
  it("reads a token with no version as 0", () => {
    expect(isSessionCurrent({}, active(0))).toBe(true);
    expect(isSessionCurrent({ sessionVersion: undefined }, active(0))).toBe(true);
    expect(isSessionCurrent({ sessionVersion: null }, active(0))).toBe(true);
  });

  it("still ends a pre-deploy token at the first bump", () => {
    expect(isSessionCurrent({}, active(1))).toBe(false);
  });

  it("rejects a token older than the row", () => {
    expect(isSessionCurrent({ sessionVersion: 1 }, active(2))).toBe(false);
  });

  it("rejects a token newer than the row", () => {
    expect(isSessionCurrent({ sessionVersion: 2 }, active(1))).toBe(false);
  });

  it("rejects an inactive user even when the version matches", () => {
    expect(isSessionCurrent({ sessionVersion: 4 }, { isActive: false, sessionVersion: 4 })).toBe(
      false,
    );
    expect(isSessionCurrent({}, { isActive: false, sessionVersion: 0 })).toBe(false);
  });

  it("rejects a token whose user no longer exists", () => {
    expect(isSessionCurrent({ sessionVersion: 0 }, null)).toBe(false);
    expect(isSessionCurrent({}, null)).toBe(false);
  });

  it("does not coerce: a version of the wrong type never matches", () => {
    expect(isSessionCurrent({ sessionVersion: "0" }, active(0))).toBe(false);
    expect(isSessionCurrent({ sessionVersion: "2" }, active(2))).toBe(false);
    expect(isSessionCurrent({ sessionVersion: false }, active(0))).toBe(false);
  });
});
