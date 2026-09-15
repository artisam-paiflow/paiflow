import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
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

const HOMEPAGE_URL = "https://beta.app.paiflow.xyz";

// PostHog US cloud, reached through a same-origin proxy (lib/analytics/client.ts).
const POSTHOG_INGEST_HOST = "https://us.i.posthog.com";
const POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";

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
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${POSTHOG_ASSETS_HOST}/static/:path*` },
      { source: "/ingest/:path*", destination: `${POSTHOG_INGEST_HOST}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
