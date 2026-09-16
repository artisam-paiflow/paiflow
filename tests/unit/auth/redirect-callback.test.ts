/**
 * `callbacks.redirect` decides where signOut() sends the browser. It has to
 * return a path rather than an absolute URL: Auth.js builds `baseUrl` from
 * `x-forwarded-host ?? host` whenever AUTH_URL is unset, which behind Railway's
 * proxy is the container's own address — signing out landed on
 * http://localhost:8080 on both paiflow.xyz and beta.app.paiflow.xyz. One
 * service answers on two hostnames, so no absolute origin is right for both.
 *
 * It is also the one place a caller-supplied URL decides where the browser
 * goes, so the open-redirect cases below matter as much as the happy ones.
 */
import { describe, it, expect } from "vitest";
import { authConfig } from "@/auth.config";

const BASE = "https://paiflow.xyz";

function redirect(url: string, baseUrl = BASE): string {
  const fn = authConfig.callbacks?.redirect;
  if (!fn) throw new Error("authConfig.callbacks.redirect is not defined");
  return fn({ url, baseUrl }) as string;
}

describe("auth redirect callback", () => {
  it("passes a path straight through, so the browser keeps the current host", () => {
    expect(redirect("/")).toBe("/");
    expect(redirect("/dashboard")).toBe("/dashboard");
    expect(redirect("/login?from=%2Fdashboard#top")).toBe("/login?from=%2Fdashboard#top");
  });

  it("reduces a same-origin absolute URL to its path", () => {
    expect(redirect(`${BASE}/dashboard`)).toBe("/dashboard");
    expect(redirect(`${BASE}/login?from=%2Fx`)).toBe("/login?from=%2Fx");
    expect(redirect(BASE)).toBe("/");
  });

  it("never returns a protocol-relative URL, which a browser treats as absolute", () => {
    expect(redirect("//evil.example")).toBe("/");
    expect(redirect("//evil.example/dashboard")).toBe("/");
    // Browsers normalise a backslash here to a slash, so it escapes too.
    expect(redirect("/\\evil.example")).toBe("/");
  });

  it("refuses another origin", () => {
    expect(redirect("https://evil.example/dashboard")).toBe("/");
    // Right host, wrong scheme — still a different origin.
    expect(redirect("http://paiflow.xyz/dashboard")).toBe("/");
    // The sibling hostname is not special-cased: the browser is already on the
    // right one, so a path is what gets it there.
    expect(redirect("https://beta.app.paiflow.xyz/dashboard")).toBe("/");
  });

  it("refuses anything that is not a URL or a path", () => {
    expect(redirect("")).toBe("/");
    expect(redirect("javascript:alert(1)")).toBe("/");
    expect(redirect("dashboard")).toBe("/");
  });
});
