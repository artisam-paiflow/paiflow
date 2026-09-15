/**
 * Runtime backstop for the privacy rules in `lib/analytics/events.ts`: whatever
 * a call site passes, no Stellar secret seed, account/contract address or XDR
 * blob leaves the app in an analytics payload. Pure, so the browser and the
 * server share it.
 */

// StrKey bodies are base32 (A-Z, 2-7). S = secret seed; G = account; M = muxed
// account; C = contract. A seed is 56 chars, a muxed account 69.
const SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;
const STRKEY_ADDRESS = /\b[GCM][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g;
// Base64 runs this long are XDR envelopes or results, never a human message.
const BASE64_BLOB = /[A-Za-z0-9+/]{80,}={0,2}/g;
const HEX_HASH = /\b[0-9a-f]{64}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const MAX_STRING = 200;
const MAX_MESSAGE_KEY = 120;

export function redactString(value: string): string {
  return value
    .replace(SECRET_SEED, "<secret>")
    .replace(STRKEY_ADDRESS, "<address>")
    .replace(BASE64_BLOB, "<blob>")
    .slice(0, MAX_STRING);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  // Nested objects are not part of any declared event shape; drop rather than
  // walk something a caller cast past the type system.
  return undefined;
}

export function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const clean = sanitizeValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/**
 * Collapse a human error message into a stable grouping key: identifiers,
 * hashes and numbers vary per occurrence, the sentence around them doesn't.
 * "Account has 1.5 XLM. Minimum 2 XLM required" and the same message with
 * other numbers land in one PostHog breakdown row.
 */
export function messageKey(message: string): string {
  return redactString(message)
    .replace(UUID, "<id>")
    .replace(HEX_HASH, "<hash>")
    .replace(/\d+(?:[.,]\d+)*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_KEY);
}
