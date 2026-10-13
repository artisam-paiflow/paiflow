/**
 * CSP helpers. Used by middleware (edge runtime), so this module must avoid
 * Node-only APIs — everything here uses Web Crypto.
 */

export const LANTERN_PARENT_ORIGINS = [
  "https://android.golantern.xyz",
  "chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd",
] as const;

// Shared with Next's static header rules. Deployment IDs are database UUIDs.
// Invalid IDs (including image-like paths skipped by middleware) must retain
// static DENY rather than lose both XFO and middleware's ancestor policy.
export const LANTERN_PUBLIC_ROUTE_PATTERN =
  "(?:trigger|allowance)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const lanternPublicRoute = new RegExp(`^/${LANTERN_PUBLIC_ROUTE_PATTERN}$`);

export function isLanternPublicRoute(pathname: string): boolean {
  return lanternPublicRoute.test(pathname);
}

export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64-encode without Buffer (edge-safe).
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === "function" ? btoa(bin) : globalThis.btoa(bin);
}

/**
 * Strict CSP. Tailored to:
 * - Next.js inline runtime (nonce-allowed)
 * - Stellar RPC over HTTPS
 * - WebAuthn (no extra origins required)
 */
export function cspHeader(nonce: string, isDev: boolean, pathname = ""): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://stellar.creit.tech",
      "https://explorer-api.walletconnect.com",
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://*.stellar.org",
      "https://horizon-testnet.stellar.org",
      "https://soroban-testnet.stellar.org",
      "https://api.pwnedpasswords.com",
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "https://relay.walletconnect.com",
      "https://relay.walletconnect.org",
      "https://*.walletconnect.com",
      "https://*.walletconnect.org",
      ...(isDev ? ["ws:", "http:"] : []),
    ],
    // WalletConnect core loads the Verify attestation in an iframe. Without an
    // explicit frame-src this falls back to default-src 'self' and is blocked
    // on every page load; the pairing survives it, but the console fills with
    // violations and the origin never resolves as verified (#594).
    "frame-src": ["'self'", "https://verify.walletconnect.com", "https://verify.walletconnect.org"],
    "frame-ancestors": isLanternPublicRoute(pathname) ? [...LANTERN_PARENT_ORIGINS] : ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}
