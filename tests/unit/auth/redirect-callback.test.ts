/**
 * `callbacks.redirect` sanitises the callbackUrl a caller supplies.
 *
 * The contract that matters most is the least obvious one: the return value has
 * to parse as an absolute URL. Every signIn() in this app passes
 * `redirect: false`, and next-auth's client then runs `new URL(data.url)` to
 * read the error param out of it (next-auth/react.js). Returning a path there
 * throws TypeError inside signIn, which escapes the login form's action and
 * trips the error boundary — shipped once, in #511, and caught in staging
 * rather than here because the original test exercised the callback as a pure
 * function and never asserted what its one caller needs. Hence
 * `expectUrlParseable` over the whole table below.
 *
 * It is also the one place a supplied URL decides where the browser goes, so
 * the open-redirect cases carry their own weight.
 */
import { describe, it, expect } from "vitest";
import { authConfig } from "@/auth.config";

const BASE = "https://paiflow.xyz";

function redirect(url: string, baseUrl = BASE): string {
  const fn = authConfig.callbacks?.redirect;
  if (!fn) throw new Error("authConfig.callbacks.redirect is not defined");
  const out = fn({ url, baseUrl }) as string;
  // The caller's requirement, asserted on every single case.
  expect(() => new URL(out), `"${out}" must parse as an absolute URL`).not.toThrow();
  return out;
}

describe("auth redirect callback", () => {
  it("resolves a path against the base URL", () => {
    expect(redirect("/")).toBe(`${BASE}/`);
    expect(redirect("/dashboard")).toBe(`${BASE}/dashboard`);
    expect(redirect("/login?from=%2Fdashboard#top")).toBe(`${BASE}/login?from=%2Fdashboard#top`);
  });

  it("keeps a same-origin absolute URL", () => {
    expect(redirect(`${BASE}/dashboard`)).toBe(`${BASE}/dashboard`);
    expect(redirect(`${BASE}/login?from=%2Fx`)).toBe(`${BASE}/login?from=%2Fx`);
  });

  it("never lets a protocol-relative URL choose the host", () => {
    // A browser reads "//host" as absolute, so resolving it against baseUrl
    // would hand the destination to the caller.
    expect(redirect("//evil.example")).toBe(BASE);
    expect(redirect("//evil.example/dashboard")).toBe(BASE);
    // Browsers normalise the backslash to a slash, so it escapes the same way.
    expect(redirect("/\\evil.example")).toBe(BASE);
  });

  it("refuses another origin", () => {
    expect(redirect("https://evil.example/dashboard")).toBe(BASE);
    // Right host, wrong scheme — still a different origin.
    expect(redirect("http://paiflow.xyz/dashboard")).toBe(BASE);
    // The sibling hostname is not special-cased. Nothing navigates to this
    // value anyway: topbar.tsx signs out with redirect:false and sets the
    // location itself, so the browser stays on whichever host it is on.
    expect(redirect("https://beta.app.paiflow.xyz/dashboard")).toBe(BASE);
  });

  it("refuses anything that is not a URL or a path", () => {
    expect(redirect("")).toBe(BASE);
    expect(redirect("javascript:alert(1)")).toBe(BASE);
    expect(redirect("dashboard")).toBe(BASE);
  });
});
