import { describe, expect, it } from "vitest";
import { cspHeader } from "@/lib/csp";

function directive(header: string, name: string): string[] {
  const found = header.split("; ").find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

const PROD = cspHeader("test-nonce", false);

describe("cspHeader", () => {
  it("allows both WalletConnect relay origins over wss and https", () => {
    const connect = directive(PROD, "connect-src");
    for (const origin of [
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "https://relay.walletconnect.com",
      "https://relay.walletconnect.org",
    ]) {
      expect(connect).toContain(origin);
    }
  });

  it("allows the .org WalletConnect hosts, not just .com", () => {
    // core 2.11.2 reaches verify.walletconnect.org as well as .com; listing
    // only the two relay hostnames left every other .org host blocked (#594).
    expect(directive(PROD, "connect-src")).toContain("https://*.walletconnect.org");
  });

  it("sets frame-src explicitly so the Verify iframe is not caught by default-src", () => {
    // frame-src falls back to child-src and then default-src 'self'. With no
    // frame-src at all the Verify iframe was blocked on every page load.
    const frame = directive(PROD, "frame-src");
    expect(frame).toContain("https://verify.walletconnect.com");
    expect(frame).toContain("https://verify.walletconnect.org");
  });

  it("keeps the page itself unframeable", () => {
    expect(directive(PROD, "frame-ancestors")).toEqual(["'none'"]);
  });

  it("does not leak dev-only sources into a production header", () => {
    expect(PROD).not.toContain("'unsafe-eval'");
    expect(directive(PROD, "connect-src")).not.toContain("ws:");
  });
});
