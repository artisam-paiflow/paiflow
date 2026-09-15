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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
    ];
  },
};

export default nextConfig;
