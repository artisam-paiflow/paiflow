/**
 * `safeReturnPath` decides where the browser lands after a successful sign-in.
 *
 * Its input is the `?from=` param middleware sets when it bounces an
 * unauthenticated visitor, so it is attacker-supplied whenever someone hands
 * out a `/login?from=…` link. Land a freshly-authenticated visitor on a
 * look-alike host and the page can ask them for anything — on an app whose
 * users sign wallet transactions, that is the whole attack.
 *
 * Both call sites (components/auth/login-form.tsx, components/auth/passkey-login.tsx)
 * previously tested `from.startsWith("/")`, which #515 showed accepts three
 * different ways of naming another host. The table below is the record of them.
 *
 * Unlike `callbacks.redirect` (tests/unit/auth/redirect-callback.test.ts), this
 * returns a *path*: `window.location.href` resolves it against the origin the
 * visitor is already on, and nothing hands it to next-auth, so the
 * absolute-URL contract that applies there does not apply here.
 */
import { describe, it, expect } from "vitest";
import { safeReturnPath } from "@/lib/safe-return-path";

const ORIGIN = "https://paiflow.xyz";

function target(from: string | undefined, origin = ORIGIN): string {
  const out = safeReturnPath(from, origin);
  // The caller assigns this to window.location.href, where anything but a
  // rooted path is resolved against the current document instead — or, for
  // "//host", against another origin entirely.
  expect(out.startsWith("/"), `"${out}" must be a rooted path`).toBe(true);
  expect(out.startsWith("//"), `"${out}" must not be protocol-relative`).toBe(false);
  return out;
}

describe("safeReturnPath() — the post-login destination", () => {
  it("keeps a same-origin path whole, query and fragment included", () => {
    expect(target("/dashboard")).toBe("/dashboard");
    expect(target("/flows/abc?tab=events#log")).toBe("/flows/abc?tab=events#log");
    // What middleware.ts:116 actually writes.
    expect(target("/deployments/6f1b/settings")).toBe("/deployments/6f1b/settings");
  });

  it("falls back to the dashboard when there is nothing to return to", () => {
    expect(target(undefined)).toBe("/dashboard");
    // `?from=` present but empty is an absent destination, not a request for
    // the origin root — hence `from || fallback` rather than `??`.
    expect(target("")).toBe("/dashboard");
  });

  it("reduces a same-origin absolute URL to its path", () => {
    expect(target(`${ORIGIN}/dashboard`)).toBe("/dashboard");
    expect(target(`${ORIGIN}/login?from=%2Fx`)).toBe("/login?from=%2Fx");
  });

  it("never lets a protocol-relative reference choose the host", () => {
    // Both of these pass `startsWith("/")` and navigate cross-origin — the
    // bug #515 reported.
    expect(target("//evil.example")).toBe("/dashboard");
    expect(target("//evil.example/dashboard")).toBe("/dashboard");
    // A browser normalises the backslash to a slash.
    expect(target("/\\evil.example")).toBe("/dashboard");
  });

  it("is not fooled by a control character before the second slash", () => {
    // The URL parser strips TAB/LF/CR *before* it parses, so these look like
    // paths to any check on the character after the leading slash and still
    // resolve to evil.com. Resolving first and comparing origins is what
    // catches them; these cases exist so nobody adds that check back.
    expect(target("/\t/evil.com")).toBe("/dashboard");
    expect(target("/\n/evil.com")).toBe("/dashboard");
    expect(target("/\r/evil.com")).toBe("/dashboard");
    expect(target("/\t//evil.com")).toBe("/dashboard");
    expect(target("/\t\\evil.com")).toBe("/dashboard");
  });

  it("refuses a foreign origin however it is spelled", () => {
    expect(target("https://evil.example/dashboard")).toBe("/dashboard");
    // Right host, wrong scheme.
    expect(target("http://paiflow.xyz/dashboard")).toBe("/dashboard");
    // A hostname that merely ends with ours.
    expect(target("https://paiflow.xyz.evil.example/dashboard")).toBe("/dashboard");
    // Credentials do not clear the comparison either, since the origin differs.
    expect(target("https://paiflow.xyz@evil.example/dashboard")).toBe("/dashboard");
  });

  it("refuses a scheme that is not a location", () => {
    expect(target("javascript:alert(1)")).toBe("/dashboard");
    expect(target("data:text/html,<script>alert(1)</script>")).toBe("/dashboard");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeReturnPath("//evil.example", ORIGIN, "/login")).toBe("/login");
  });

  it("falls back rather than throwing when the origin is unusable", () => {
    // A sandboxed iframe reports its origin as the string "null", which is not
    // a base the parser accepts. Asking for /flows proves the fallback ran
    // rather than the path surviving by coincidence.
    expect(safeReturnPath("/flows", "null")).toBe("/dashboard");
  });
});
