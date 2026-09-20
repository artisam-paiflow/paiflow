/**
 * The #581 SSRF guard. Most of these cases exist because the obvious
 * implementation of each rule is subtly wrong:
 *
 *  - `new URL("https://[::1]/").hostname` keeps the brackets, so `isIP()` says 0
 *    for it and every IPv6 literal walks through a naive check.
 *  - `BlockList.check()` defaults to the "ipv4" family, so a v4-mapped address
 *    checked without "ipv6" comes back allowed; and it returns false, rather
 *    than throwing, for a string that is not an address at all.
 *  - `URL` normalises `127.1`, `0x7f.0.0.1`, `2130706433`, `0177.0.0.1` and `0`
 *    to dotted quads for us — pinned here so a rewrite away from `URL` cannot
 *    silently regress it.
 *  - A single-label host (`http://minio/`) is the real Railway/Docker shape.
 *
 * `lookup` is injected rather than mocked, so these cases never touch DNS. The
 * default wiring is covered separately in `public-url-dns.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkPublicHttpsUrl,
  checkPublicUrlShape,
  isBlockedAddress,
  MAX_URL_LENGTH,
  TERMINAL_URL_REJECTIONS,
  type ResolvedAddress,
} from "@/lib/net/public-url";

const publicV4: ResolvedAddress[] = [{ address: "93.184.216.34", family: 4 }];
const lookupPublic = () => Promise.resolve(publicV4);

describe("checkPublicUrlShape", () => {
  it("accepts a public https URL", () => {
    const result = checkPublicUrlShape("https://relayer.example.com/charge");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hostname).toBe("relayer.example.com");
      expect(result.url.pathname).toBe("/charge");
    }
  });

  it("accepts a non-standard port on a public host", () => {
    // A tenant relayer on :8443 is legitimate; ports are not the boundary.
    expect(checkPublicUrlShape("https://relayer.example.com:8443/charge").ok).toBe(true);
  });

  it.each([
    "http://relayer.example.com/charge",
    "ftp://relayer.example.com/",
    "file:///etc/passwd",
    "gopher://relayer.example.com/",
    "data:text/plain,hello",
  ])("refuses the scheme of %s", (raw) => {
    const result = checkPublicUrlShape(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme");
  });

  it.each(["https://user:pass@relayer.example.com/", "https://user@relayer.example.com/"])(
    "refuses credentials in %s",
    (raw) => {
      const result = checkPublicUrlShape(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("credentials");
    },
  );

  it.each([
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://127.1/",
    "https://0x7f.0.0.1/",
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://0/",
    "https://255.255.255.255/",
  ])("refuses the IP literal %s", (raw) => {
    const result = checkPublicUrlShape(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ip-literal");
  });

  it.each([
    "https://localhost/",
    "https://LOCALHOST./",
    "https://foo.localhost/",
    "https://redis.railway.internal/",
    "https://redis.railway.INTERNAL./",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://nas.local/",
    "https://router.home.arpa/",
    "https://box.localdomain/",
    "https://printer.lan/",
    "https://minio/",
    "https://redis/",
  ])("refuses the internal name %s", (raw) => {
    const result = checkPublicUrlShape(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("internal-name");
  });

  it.each(["not a url", "", "https://"])("refuses the unparseable %s", (raw) => {
    const result = checkPublicUrlShape(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-a-url");
  });

  it("refuses a URL longer than the cap", () => {
    const result = checkPublicUrlShape(`https://${"a".repeat(MAX_URL_LENGTH)}.example.com/`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-long");
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])("blocks the IPv4 address %s", (address) => {
    expect(isBlockedAddress(address, 4)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "198.20.0.1",
    "223.255.255.255",
  ])("allows the IPv4 address %s", (address) => {
    expect(isBlockedAddress(address, 4)).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001:0:1234::1", // Teredo
    "2002:a00:1::1", // 6to4
    "64:ff9b::a00:1", // NAT64
    "100::1",
  ])("blocks the IPv6 address %s", (address) => {
    expect(isBlockedAddress(address, 6)).toBe(true);
  });

  it.each(["::ffff:10.1.2.3", "::ffff:a00:1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"])(
    "blocks the v4-mapped address %s when checked as IPv6",
    (address) => {
      expect(isBlockedAddress(address, 6)).toBe(true);
    },
  );

  it.each(["2606:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows the IPv6 address %s",
    (address) => {
      expect(isBlockedAddress(address, 6)).toBe(false);
    },
  );

  it.each([
    ["notanip", 4],
    ["", 4],
    ["1.1.1.1", 0],
    ["1.1.1.1", 10],
  ] as const)("fails closed for (%s, %s)", (address, family) => {
    expect(isBlockedAddress(address, family)).toBe(true);
  });
});

describe("checkPublicHttpsUrl", () => {
  it("accepts a name that resolves to a public address", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/charge", {
      lookup: lookupPublic,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.toString()).toBe("https://relayer.example.com/charge");
  });

  it("resolves the bare, lowercased, dot-stripped hostname", async () => {
    const lookup = vi.fn(lookupPublic);
    await checkPublicHttpsUrl("https://Relayer.Example.COM./charge", { lookup });
    expect(lookup).toHaveBeenCalledWith("relayer.example.com");
  });

  it("refuses a name that resolves to a private address, without naming the address", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () => Promise.resolve([{ address: "10.0.0.5", family: 4 }]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("private-address");
      expect(result.detail).not.toContain("10.0.0.5");
    }
  });

  it("refuses when any one of several answers is private", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () =>
        Promise.resolve([
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private-address");
  });

  it("refuses a name resolving to a v4-mapped private address", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () => Promise.resolve([{ address: "::ffff:10.0.0.1", family: 6 }]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private-address");
  });

  it("refuses an empty answer set", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () => Promise.resolve([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unresolvable");
  });

  it("refuses an unresolvable name without leaking the resolver error", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () =>
        Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" })),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unresolvable");
      expect(result.detail).not.toContain("getaddrinfo");
    }
  });

  it("gives up on a resolver that never answers", async () => {
    const result = await checkPublicHttpsUrl("https://relayer.example.com/", {
      lookup: () => new Promise<ResolvedAddress[]>(() => {}),
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("resolve-timeout");
  });

  it("does not resolve anything for a shape failure", async () => {
    const lookup = vi.fn(lookupPublic);
    const result = await checkPublicHttpsUrl("https://10.0.0.5/", { lookup });
    expect(result.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("TERMINAL_URL_REJECTIONS", () => {
  it("treats deterministic refusals as terminal", () => {
    for (const reason of [
      "not-a-url",
      "too-long",
      "scheme",
      "credentials",
      "ip-literal",
      "internal-name",
      "private-address",
    ] as const) {
      expect(TERMINAL_URL_REJECTIONS.has(reason)).toBe(true);
    }
  });

  it("does not let a transient DNS failure switch a tenant off", () => {
    expect(TERMINAL_URL_REJECTIONS.has("unresolvable")).toBe(false);
    expect(TERMINAL_URL_REJECTIONS.has("resolve-timeout")).toBe(false);
  });
});
