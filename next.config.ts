import type { NextConfig } from "next";
import { LANTERN_PUBLIC_ROUTE_PATTERN } from "./lib/csp";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(self), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const HOMEPAGE_URL = "https://beta.paiflow.xyz";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PostHog's ingestion paths end in a slash; a redirect would drop the POST body.
  skipTrailingSlashRedirect: true,
  env: {
    // Tags analytics events with the deployed commit, so a before/after split
    // (e.g. the D3 swap-panel rebuild) is a PostHog breakdown, not a date guess.
    NEXT_PUBLIC_APP_VERSION: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  },
  serverExternalPackages: [
    "@stellar/stellar-sdk",
    "@stellar/stellar-base",
    "sodium-native",
    "require-addon",
    "argon2",
    "@simplewebauthn/server",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  // The marketing pages live in homepage/ as a separate static service, so the
  // app only contains the app. Old links keep working.
  async redirects() {
    return [
      { source: "/about", destination: `${HOMEPAGE_URL}/about.html`, permanent: true },
      { source: "/privacy", destination: `${HOMEPAGE_URL}/privacy.html`, permanent: true },
      { source: "/terms", destination: `${HOMEPAGE_URL}/terms.html`, permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Keep DENY on every other route, including assets outside middleware.
        // Public payment pages use middleware's exact CSP ancestor allowlist;
        // an X-Frame-Options DENY here would conflict with that permission.
        source: `/:path((?!${LANTERN_PUBLIC_ROUTE_PATTERN}$).*)`,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
