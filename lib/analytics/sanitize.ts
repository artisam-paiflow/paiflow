/**
 * Runtime backstop for the privacy rules in `lib/analytics/events.ts`: whatever
 * a call site passes, no Stellar secret seed, account/contract address, XDR
 * blob, app-minted credential or email address leaves the app in an analytics
 * payload. Transaction hashes and UUIDs pass on purpose: the funnel joins on them. Pure, so the browser and the
 * server share it.
 *
 * One deliberate exception, added 17 September 2026 for wallet ↔ user ↔ tx
 * traceability (docs/analytics/alpha-tracking-plan.md, "Wallet traceability"):
 * the property names in `ADDRESS_ALLOWED_KEYS` may carry the signing wallet's
 * own public address. The value must BE a `G…` account address — anchored, so
 * a seed, an XDR blob, a contract address or a sentence with an address in it
 * is dropped rather than sent. Recipient addresses stay redacted everywhere.
 */

// StrKey bodies are base32 (A-Z, 2-7). S = secret seed; G = account; M = muxed
// account; C = contract. A seed is 56 chars, a muxed account 69.
const SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;
const STRKEY_ADDRESS = /\b[GCM][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g;
// Base64 runs this long are XDR envelopes or results, never a human message.
const BASE64_BLOB = /[A-Za-z0-9+/]{80,}={0,2}/g;
// A separate class rather than widening the one above: `/` and `-` together
// would swallow `/deployments/<uuid>/payroll-runs/<uuid>` in $pathname, which
// stays readable by decision (#517, 17 Sep 2026).
const BASE64URL_BLOB = /[A-Za-z0-9_-]{80,}/g;
// Credentials this app mints and shows once: `pfk_` partner tokens
// (lib/api/v1/tokens.ts) and `whsec_` webhook secrets. Both are 68 chars, under
// every length-based rule here.
const PREFIXED_SECRET = /\b(?:pfk|whsec)_[0-9a-f]{32,}\b/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// Sandbox and passkey sign-in tickets: `<User.id>.<epoch ms>.<32 hex>`.
const LOGIN_TICKET = /\b[0-9a-f-]{36}\.\d{13}\.[0-9a-f]{32}\b/gi;
// `/auth/new-password?token=…` carries a live reset token (43 chars of
// base64url) into $current_url and $referrer.
const SECRET_QUERY_PARAM = /([?&](?:token|ticket|code|secret|key)=)[^&#\s]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const HEX_HASH = /\b[0-9a-f]{64}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const MAX_STRING = 200;
const MAX_MESSAGE_KEY = 120;

const ADDRESS_ALLOWED_KEYS = new Set(["wallet_address", "wallet_address_first", "signer_address"]);
// Anchored on purpose: the whole value is one account address, or it is dropped.
// No `StrKey` import here — this module reaches the root layout's bundle, and
// the checksum is not what keeps a seed out; the leading letter and the anchors are.
const ED25519_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

export function isAddressAllowedKey(key: string): boolean {
  return ADDRESS_ALLOWED_KEYS.has(key);
}

export function redactString(value: string): string {
  return value
    .replace(SECRET_SEED, "<secret>")
    .replace(PREFIXED_SECRET, "<token>")
    .replace(JWT, "<token>")
    .replace(LOGIN_TICKET, "<ticket>")
    .replace(SECRET_QUERY_PARAM, "$1<redacted>")
    .replace(EMAIL, "<email>")
    .replace(STRKEY_ADDRESS, "<address>")
    .replace(BASE64_BLOB, "<blob>")
    .replace(BASE64URL_BLOB, "<blob>")
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

/**
 * The single decision point for one property, shared by `sanitizeProps` and
 * the browser's `before_send`. Returns `undefined` to drop the key.
 */
export function sanitizeEntry(key: string, value: unknown): unknown {
  if (isAddressAllowedKey(key)) {
    return typeof value === "string" && ED25519_PUBLIC_KEY.test(value) ? value : undefined;
  }
  return sanitizeValue(value);
}

export function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const clean = sanitizeEntry(key, value);
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
