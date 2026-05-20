import "server-only";
import crypto from "node:crypto";

/**
 * Password-reset token cryptography. The raw token travels in the email link;
 * the database stores only its SHA-256 hash so a leaked PasswordResetToken
 * row can't be used to mint a valid reset link.
 */

const TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MINUTES = 60;

/** Generate a fresh raw token (URL-safe base64, ~43 chars). */
export function generateResetToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash a raw token for storage / lookup. Deterministic, no salt. */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function resetTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}
