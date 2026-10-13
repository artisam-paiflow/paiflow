import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import nextConfig from "@/next.config";
import { cspHeader } from "@/lib/csp";

vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
import middleware, { config } from "@/middleware";

const ID = "11111111-1111-4111-8111-111111111111";
const APPROVED = [
  "https://android.golantern.xyz",
  "chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd",
];
const run = middleware as unknown as (
  req: NextRequest & { auth: { user: { id: string; role: string } } | null },
) => Response;

function ancestors(response: Response): string[] {
  return response.headers
    .get("Content-Security-Policy")!
    .split("; ")
    .find((part) => part.startsWith("frame-ancestors "))!
    .split(" ")
    .slice(1);
}

async function response(path: string, role: string | null = null, origin?: string) {
  // Next applies configured headers before middleware. Exercise the installed
  // Next matcher so static DENY cannot silently reappear on the public pages.
  const headers = new Headers();
  for (const rule of await nextConfig.headers!()) {
    if (getPathMatch(rule.source)(path)) {
      for (const header of rule.headers) headers.set(header.key, header.value);
    }
  }
  if (!unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://paiflow.test${path}` })) {
    return new Response(null, { headers });
  }
  const result = run(
    Object.assign(
      new NextRequest(`https://paiflow.test${path}`, {
        headers: origin ? { origin } : undefined,
      }),
      { auth: role ? { user: { id: "viewer", role } } : null },
    ),
  );
  result.headers.forEach((value, key) => headers.set(key, value));
  return new Response(null, { status: result.status, headers });
}

describe("Lantern framing boundary", () => {
  it.each([`/trigger/${ID}`, `/allowance/${ID}`])(
    "permits only the approved parents on %s",
    async (path) => {
      for (const origin of [
        ...APPROVED,
        "https://localhost",
        "https://evil.test",
        "chrome-extension://other",
      ]) {
        const res = await response(path, null, origin);
        expect(res.status).toBe(200);
        expect(ancestors(res)).toEqual(APPROVED);
        expect(res.headers.has("X-Frame-Options")).toBe(false);
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      }
    },
  );

  it.each([
    "/",
    "/login",
    "/dashboard",
    "/trigger",
    "/allowance",
    `/trigger/${ID}/`,
    `/allowance/${ID}/`,
    `/trigger/${ID}/extra`,
    `/allowance/${ID}/extra`,
    `/deployments/${ID}/embed`,
    "/trigger/not-a-uuid",
    "/allowance/not-a-uuid",
    `/api/deployments/${ID}/subscription-allowance`,
  ])("keeps unsupported path %s unframeable", async (path) => {
    const res = await response(path);
    expect(ancestors(res)).toEqual(["'none'"]);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("keeps sandbox redirects and the resulting dashboard closed", async () => {
    const res = await response(`/allowance/${ID}`, "SANDBOX");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://paiflow.test/dashboard");
    expect(ancestors(res)).toEqual(["'none'"]);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(ancestors(await response("/dashboard", "SANDBOX"))).toEqual(["'none'"]);
  });

  it("retains login redirects and protected API authentication", async () => {
    const page = await response("/dashboard");
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).pathname).toBe("/login");
    expect((await response(`/api/deployments/${ID}/invoke`)).status).toBe(401);
    expect(ancestors(await response("/login"))).toEqual(["'none'"]);
  });

  it.each(["/_next/static/app.js", "/favicon.ico", "/logo.svg", "/ingest/batch/"])(
    "retains static DENY on middleware-excluded %s",
    async (path) => {
      const rules = await nextConfig.headers!();
      const headers = rules
        .filter((rule) => getPathMatch(rule.source)(path))
        .flatMap((rule) => rule.headers);
      expect(headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    },
  );

  it.each([
    "/trigger/foo.png",
    "/allowance/foo.svg",
    `/trigger/${ID}.jpg`,
    `/allowance/${ID}.webp`,
  ])("retains DENY when middleware skips image-like payment path %s", async (path) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://paiflow.test${path}` }),
    ).toBe(false);
    const res = await response(path);
    expect(res.headers.has("Content-Security-Policy")).toBe(false);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("preserves every other production CSP directive", () => {
    const base = cspHeader("nonce", false);
    const framed = cspHeader("nonce", false, `/trigger/${ID}`);
    expect(framed.replace(`frame-ancestors ${APPROVED.join(" ")}`, "frame-ancestors 'none'")).toBe(
      base,
    );
  });
});
