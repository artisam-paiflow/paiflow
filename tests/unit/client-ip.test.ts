/**
 * `clientIp()` decides the address every per-IP rate limit and `AuditLog.ip`
 * sees (#433). Driven through the real env schema: each case sets
 * `TRUSTED_PROXY_HOPS` and re-imports so `env()`'s memoized parse is fresh.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ redis: () => null }));

async function load(hops?: string) {
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = hops;
  vi.resetModules();
  return await import("@/lib/rate-limit");
}

function req(headers: Record<string, string>): Request {
  return new Request("https://paiflow.xyz/api/webhooks/offramp", { headers });
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  vi.resetModules();
});

describe("clientIp — default (TRUSTED_PROXY_HOPS unset), Railway's replacing edge", () => {
  it("reads a single X-Forwarded-For entry, as Railway's edge sends it", async () => {
    const { clientIp } = await load();
    expect(clientIp(req({ "x-forwarded-for": "136.158.32.30" }))).toBe("136.158.32.30");
  });

  it("takes the leftmost entry of a chain, exactly as before", async () => {
    const { clientIp } = await load();
    expect(clientIp(req({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" }))).toBe(
      "203.0.113.7",
    );
  });

  it("prefers X-Forwarded-For over X-Real-IP, since only the former was observed replaced", async () => {
    const { clientIp } = await load();
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.88" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to X-Real-IP only when X-Forwarded-For is absent", async () => {
    const { clientIp } = await load();
    expect(clientIp(req({ "x-real-ip": "198.51.100.88" }))).toBe("198.51.100.88");
  });

  it("returns the shared unknown bucket when neither header is present", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load();
    expect(clientIp(req({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(UNKNOWN_CLIENT_IP).toBe("0.0.0.0");
  });

  it("does not fall through to X-Real-IP when the chosen X-Forwarded-For entry is garbage", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load();
    expect(clientIp(req({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.88" }))).toBe(
      UNKNOWN_CLIENT_IP,
    );
  });

  it("treats an empty X-Forwarded-For as absent, as the old `if (xff)` did", async () => {
    const { clientIp } = await load();
    expect(clientIp(req({ "x-forwarded-for": " ", "x-real-ip": "198.51.100.88" }))).toBe(
      "198.51.100.88",
    );
  });

  it("reads the first of duplicate X-Forwarded-For headers, which Headers joins with a comma", async () => {
    const { clientIp } = await load();
    const r = new Request("https://paiflow.xyz/", {
      headers: [
        ["x-forwarded-for", "203.0.113.7"],
        ["x-forwarded-for", "198.51.100.77"],
      ],
    });
    expect(clientIp(r)).toBe("203.0.113.7");
  });

  it("an empty TRUSTED_PROXY_HOPS is the default", async () => {
    const { clientIp } = await load("");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
});

describe("clientIp — TRUSTED_PROXY_HOPS behind appending proxies", () => {
  it("hops=1 ignores whatever the client prepended", async () => {
    const { clientIp } = await load("1");
    // Client sent "1.1.1.1, 2.2.2.2"; the one trusted proxy appended the real peer.
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("hops=2 takes the second entry from the right", async () => {
    const { clientIp } = await load("2");
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7, 10.0.0.5" }))).toBe(
      "203.0.113.7",
    );
  });

  it("trusts nothing in a chain shorter than the hop count (a request that bypassed the proxies)", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load("3");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.5" }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it("ignores X-Real-IP once hops are configured", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load("1");
    expect(clientIp(req({ "x-real-ip": "198.51.100.88" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp(req({}))).toBe(UNKNOWN_CLIENT_IP);
  });

  it("an empty or garbage entry at the trusted position is the unknown bucket, never a neighbour", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load("1");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7," }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, unknown" }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it("handles an IPv6 chain", async () => {
    const { clientIp } = await load("2");
    expect(clientIp(req({ "x-forwarded-for": "2001:db8::bad, [2001:DB8::7]:443, fd00::1" }))).toBe(
      "2001:db8::7",
    );
  });

  it("accepts the upper bound of 10", async () => {
    const { clientIp } = await load("10");
    const chain = ["203.0.113.7", ...Array.from({ length: 9 }, (_, i) => `10.0.0.${i + 1}`)];
    expect(clientIp(req({ "x-forwarded-for": chain.join(", ") }))).toBe("203.0.113.7");
  });

  it("hops=1 with a single entry equals today's answer", async () => {
    const { clientIp } = await load("1");
    expect(clientIp(req({ "x-forwarded-for": "136.158.32.30" }))).toBe("136.158.32.30");
  });

  it.each(["-1", "11", "1.5", "one"])(
    "throws on first use with TRUSTED_PROXY_HOPS=%s, like any invalid env var",
    async (v) => {
      const { clientIp } = await load(v);
      expect(() => clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toThrow(
        /TRUSTED_PROXY_HOPS/,
      );
    },
  );
});

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["  203.0.113.7\t", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["2001:DB8::0:1", "2001:db8::1"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["fe80::1%eth0", "fe80::1"],
    ["[fe80::1%25eth0]:443", "fe80::1"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:cb00:7107", "203.0.113.7"],
    ["::1", "::1"],
  ])("%j -> %j", async (raw, expected) => {
    const { normalizeIp } = await load();
    expect(normalizeIp(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "unknown",
    "localhost",
    "example.com",
    "256.0.0.1",
    "1.2.3",
    "1.2.3.4.5",
    "010.0.0.1",
    "1.2.3.4%eth0",
    "2001:db8::g",
    "2001:db8:::1",
    "[2001:db8::1",
    "::ffff:1.2.3.4:80",
    "1.2.3.4/24",
    "1".repeat(65),
    `2001:db8::1${" ".repeat(2000)}x`,
    "<script>",
    "1.2.3.4\u0000",
  ])("rejects %j", async (raw) => {
    const { normalizeIp } = await load();
    expect(normalizeIp(raw)).toBeNull();
  });

  it("bounds the rate-limit key: an oversized header collapses to the unknown bucket", async () => {
    const { clientIp, UNKNOWN_CLIENT_IP } = await load();
    expect(clientIp(req({ "x-forwarded-for": "9".repeat(8000) }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp(req({ "x-real-ip": "a".repeat(8000) }))).toBe(UNKNOWN_CLIENT_IP);
  });
});
