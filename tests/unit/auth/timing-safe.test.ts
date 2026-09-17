/**
 * `timingSafeEqualString` replaces two hand-rolled copies (webhooks/[id] and
 * webhooks/offramp). The 128-byte case below is the bug in the copy it
 * replaced: that one wrote into a fixed 128-byte buffer, so two distinct
 * secrets sharing a 128-byte prefix compared equal.
 */
import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "@/lib/auth/timing-safe";

describe("timingSafeEqualString", () => {
  it("accepts identical strings", () => {
    expect(timingSafeEqualString("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(timingSafeEqualString("aaaaaaaaaaaa", "aaaaaaaaaaab")).toBe(false);
  });

  it("rejects strings of different length", () => {
    expect(timingSafeEqualString("short", "short-but-longer")).toBe(false);
    expect(timingSafeEqualString("short-but-longer", "short")).toBe(false);
  });

  it("rejects a prefix of the expected value", () => {
    expect(timingSafeEqualString("s3cret", "s3cret-value")).toBe(false);
  });

  it("handles empty strings without throwing", () => {
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("", "x")).toBe(false);
    expect(timingSafeEqualString("x", "")).toBe(false);
  });

  it("compares multi-byte UTF-8 by bytes", () => {
    expect(timingSafeEqualString("séçret-✓", "séçret-✓")).toBe(true);
    expect(timingSafeEqualString("séçret-✓", "séçret-✗")).toBe(false);
  });

  it("does not truncate past 128 bytes", () => {
    const prefix = "a".repeat(128);
    expect(timingSafeEqualString(`${prefix}X`, `${prefix}Y`)).toBe(false);
    expect(timingSafeEqualString(`${prefix}X`, `${prefix}X`)).toBe(true);
  });
});
