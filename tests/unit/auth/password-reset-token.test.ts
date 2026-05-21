import { describe, expect, it } from "vitest";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  RESET_TOKEN_TTL_MINUTES,
} from "@/lib/auth/password-reset";

describe("password-reset token helpers", () => {
  it("generates URL-safe tokens (no +, /, = padding)", () => {
    for (let i = 0; i < 50; i++) {
      const t = generateResetToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 bytes of base64url is 43 chars (no padding).
      expect(t.length).toBe(43);
    }
  });

  it("generates unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i++) tokens.add(generateResetToken());
    expect(tokens.size).toBe(500);
  });

  it("hashes deterministically", () => {
    const t = generateResetToken();
    expect(hashResetToken(t)).toBe(hashResetToken(t));
  });

  it("hashes produce 64-char hex", () => {
    expect(hashResetToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different tokens hash to different values", () => {
    const a = hashResetToken(generateResetToken());
    const b = hashResetToken(generateResetToken());
    expect(a).not.toBe(b);
  });

  it("expiresAt is ~60 minutes in the future", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const exp = resetTokenExpiresAt(now);
    expect(exp.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  });
});
