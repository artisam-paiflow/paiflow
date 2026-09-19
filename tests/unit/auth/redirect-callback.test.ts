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
 * the open-redirect cases carry their own weight. @auth/core hands this the raw
 * `callbackUrl` param *and* the stored callback-url cookie
 * (lib/utils/callback-url.js), and persists what comes back as that cookie.
 *
 * #515 broke it: the guard was a regex on the character after the leading
 * slash, and the URL parser strips TAB/LF/CR before parsing, so a tab smuggled
 * "//evil.com" past it. The callback now resolves and compares origins, with no
 * pre-parse inspection at all.
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

  it("is not fooled by a control character before the second slash", () => {
    // #515. The guard this replaced tested the character after the leading
    // slash, which looks sufficient until you know the URL parser strips
    // TAB/LF/CR *before* it parses: to that regex "/\t/evil.com" was a path,
    // and it then resolved to https://evil.com/. Nothing here inspects
    // characters any more — the parser normalises, and only the origin of what
    // comes out is compared — so these are the regression record, not a
    // blocklist. Don't reintroduce a pre-parse shape check.
    expect(redirect("/\t/evil.com")).toBe(BASE);
    expect(redirect("/\n/evil.com")).toBe(BASE);
    expect(redirect("/\r/evil.com")).toBe(BASE);
    expect(redirect("/\t//evil.com")).toBe(BASE);
    expect(redirect("/\t\\evil.com")).toBe(BASE);
  });

  it("refuses credentials smuggled into a same-origin URL", () => {
    // .origin ignores userinfo, so this one clears the origin comparison. It
    // is the right host, but the value is persisted as the callback-url
    // cookie and there is no reason for credentials to ride along.
    expect(redirect("https://user:pw@paiflow.xyz/dashboard")).toBe(BASE);
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

  it("refuses a URL whose origin is not an origin at all", () => {
    // Resolving this against baseUrl succeeds; its origin is the string
    // "null", which is not baseUrl, so the comparison refuses it.
    expect(redirect("javascript:alert(1)")).toBe(BASE);
  });

  it("resolves a bare relative reference rather than refusing it", () => {
    // These two used to fall to baseUrl because the old regex demanded a
    // leading slash and `new URL(url)` then threw. Resolving against baseUrl
    // instead can only ever produce a same-origin URL, so allowing them costs
    // nothing; recorded here so the change reads as intended and not as a
    // loosened guard.
    expect(redirect("")).toBe(`${BASE}/`);
    expect(redirect("dashboard")).toBe(`${BASE}/dashboard`);
  });
});
