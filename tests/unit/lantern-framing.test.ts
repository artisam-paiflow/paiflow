import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";

vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));

import middleware, { config } from "@/middleware";
import { cspHeader, FRAME_ANCESTORS_CSP } from "@/lib/csp";
import nextConfig from "../../next.config";

const APPROVED = [
  "https://android.golantern.xyz",
  "chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd",
];
const run = middleware as unknown as (
  req: NextRequest & { auth: { user: { id: string; role: string } } | null },
) => Response;
const ID = "11111111-1111-4111-8111-111111111111";

function ancestors(csp: string): string[] {
  return csp
    .split("; ")
    .find((part) => part.startsWith("frame-ancestors "))!
    .split(" ")
    .slice(1);
}

function request(path: string, role: string | null = null) {
  return Object.assign(new NextRequest(`https://paiflow.test${path}`), {
    auth: role ? { user: { id: "viewer", role } } : null,
  });
}

describe("Lantern ancestor permission", () => {
  it.each([
    ["/", null, 200],
    [`/trigger/${ID}`, null, 200],
    [`/allowance/${ID}`, null, 200],
    [`/deployments/${ID}/embed`, null, 200],
    ["/login", null, 200],
    ["/login", "USER", 307],
    ["/dashboard", null, 307],
    ["/dashboard", "USER", 200],
    ["/api/health", null, 200],
    ["/api/account/password", null, 401],
    ["/api/admin/users", "SANDBOX", 403],
    ["/admin", "SANDBOX", 307],
  ] as const)("keeps exact CSP and auth response for %s (%s)", (path, role, status) => {
    const response = run(request(path, role));
    expect(response.status).toBe(status);
    expect(ancestors(response.headers.get("Content-Security-Policy")!)).toEqual(APPROVED);
    expect(response.headers.has("X-Frame-Options")).toBe(false);
    expect(response.headers.get("x-paiflow-nonce")).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.has("Set-Cookie")).toBe(false);
    if (path === "/dashboard" && role === null) {
      expect(response.headers.get("location")).toBe("https://paiflow.test/login?from=%2Fdashboard");
    }
  });

  it.each([
    "/trigger/example",
    "/api/health",
    "/favicon.ico",
    "/_next/static/chunk.js",
    "/image.png",
    "/deployments/example/embed",
  ])("retains static protection without conflicting XFO on %s", async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://paiflow.test${path}`,
      nextConfig,
    });
    expect(response.headers.get("Content-Security-Policy")).toBe(FRAME_ANCESTORS_CSP);
    expect(ancestors(response.headers.get("Content-Security-Policy")!)).toEqual(APPROVED);
    expect(response.headers.has("X-Frame-Options")).toBe(false);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    );
  });

  it.each(["/favicon.ico", "/_next/static/chunk.js", "/image.png"])(
    "protects actual middleware exclusions via the static policy: %s",
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, url: `https://paiflow.test${path}` })).toBe(
        false,
      );
    },
  );

  it("does not allow untrusted parents, subdomains, lookalikes or other extensions", () => {
    const policy = ancestors(cspHeader("nonce", false));
    expect(policy).toEqual(APPROVED);
    for (const untrusted of [
      "'self'",
      "*",
      "https:",
      "chrome-extension:",
      "https://evil.test",
      "https://golantern.xyz",
      "http://android.golantern.xyz",
      "https://sub.android.golantern.xyz",
      "https://android.golantern.xyz.evil.test",
      "https://android-golantern.xyz",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ])
      expect(policy).not.toContain(untrusted);
  });

  it("has the same ancestor restriction under static and full CSP enforcement", () => {
    expect(ancestors(FRAME_ANCESTORS_CSP)).toEqual(ancestors(cspHeader("nonce", false)));
    expect(cspHeader("nonce", false)).toContain("script-src 'self' 'nonce-nonce' 'strict-dynamic'");
    expect(cspHeader("nonce", false)).toContain("object-src 'none'");
  });
});
