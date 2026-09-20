/**
 * Is this URL safe for the server to fetch on a tenant's behalf?
 *
 * A tenant configures its own charge-relayer endpoint (`Deployment.chargeRelayerUrl`,
 * "USER" mode) and the auto-charge crons POST to it server-side on every due
 * tick. Before #581 the only validation was `z.string().url()`, which accepts
 * any scheme and any host — so `http://169.254.169.254/latest/meta-data/`,
 * `http://redis.railway.internal:6379/` or `http://localhost:3000/api/...` all
 * passed, and the payroll cron interpolated the whole response body into the
 * error it stores on `PayrollRun.lastError`, which the owner can read back.
 * That is a read-capable SSRF into our own private network, which CLAUDE.md §18
 * forbids outright.
 *
 * The checks that matter are the ones a naive implementation gets wrong, so
 * each is spelled out here:
 *
 *  - The host is compared as an address, not as text. `URL` already normalises
 *    every obfuscated IPv4 form for us — `127.1`, `0x7f.0.0.1`, `2130706433`,
 *    `0177.0.0.1` and `0` all come out of `u.hostname` as dotted quads — so
 *    refusing IP literals outright catches all of them at once. An https
 *    endpoint needs a name to match its certificate anyway.
 *  - `new URL("https://[::1]/").hostname` is `"[::1]"`, brackets included, and
 *    `isIP()` says 0 for that. Strip the brackets first or every IPv6 literal
 *    walks straight through.
 *  - A single-label host (`http://minio/`, `http://redis/`) is the shape a
 *    Railway or Docker service name actually takes, resolved through the
 *    container's search domain. It is refused for having no dot at all, which
 *    also means it can never carry a valid public certificate.
 *  - `BlockList.check()` defaults to the `"ipv4"` family, so checking a
 *    v4-mapped address without passing `"ipv6"` returns false. It also returns
 *    false — rather than throwing — for a string that is not an address at all.
 *    Both are fail-open, so the family comes from the lookup result and a
 *    non-address fails closed.
 *  - Three IPv6 ranges tunnel an arbitrary IPv4 address and would otherwise
 *    bypass every IPv4 rule below: NAT64 `64:ff9b::/96`, Teredo `2001::/32`
 *    and 6to4 `2002::/16`.
 *  - Every address the resolver returns is checked, not just the first: a name
 *    answering with one public and one private A record must be refused.
 *
 * `dns.lookup` (not `resolve`) is deliberate — it is the same resolver path
 * undici uses for `fetch`, so we judge the answer the connection will get.
 *
 * No `server-only` and no imports from `@/lib`: `scripts/audit-charge-relayer-urls.ts`
 * and the unit tests import this outside the Next runtime. The `AppError`
 * mapping lives next door in `assert-public-url.ts`.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const MAX_URL_LENGTH = 2048;
export const DEFAULT_RESOLVE_TIMEOUT_MS = 3_000;

export type UrlRejectionReason =
  | "not-a-url"
  | "too-long"
  | "scheme"
  | "credentials"
  | "ip-literal"
  | "internal-name"
  | "unresolvable"
  | "resolve-timeout"
  | "private-address";

/**
 * Refusals that will refuse again on the next tick however long we wait, so a
 * caller may stop retrying. `unresolvable` and `resolve-timeout` are absent on
 * purpose: one `EAI_AGAIN` must not switch off a paying tenant's automation.
 */
export const TERMINAL_URL_REJECTIONS: ReadonlySet<UrlRejectionReason> = new Set<UrlRejectionReason>(
  [
    "not-a-url",
    "too-long",
    "scheme",
    "credentials",
    "ip-literal",
    "internal-name",
    "private-address",
  ],
);

/** Suffixes that name something inside a network rather than on the internet. */
const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".localdomain",
  ".in-addr.arpa",
  ".ip6.arpa",
];

const BLOCKED = new BlockList();
// "This host", which is where `https://0/` normalises to.
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
BLOCKED.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, incl. cloud metadata
BLOCKED.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
BLOCKED.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
BLOCKED.addSubnet("192.88.99.0", 24, "ipv4"); // 6to4 relay anycast
BLOCKED.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
BLOCKED.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
BLOCKED.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
BLOCKED.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
BLOCKED.addSubnet("240.0.0.0", 4, "ipv4"); // reserved, incl. 255.255.255.255
BLOCKED.addAddress("::", "ipv6"); // unspecified
BLOCKED.addAddress("::1", "ipv6"); // loopback
BLOCKED.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 — embeds an IPv4 address
BLOCKED.addSubnet("64:ff9b:1::", 48, "ipv6"); // local-use NAT64
BLOCKED.addSubnet("100::", 64, "ipv6"); // discard-only
BLOCKED.addSubnet("2001::", 32, "ipv6"); // Teredo — tunnels to an arbitrary IPv4
BLOCKED.addSubnet("2001:db8::", 32, "ipv6"); // documentation
BLOCKED.addSubnet("2002::", 16, "ipv6"); // 6to4 — embeds an IPv4 address
BLOCKED.addSubnet("fc00::", 7, "ipv6"); // unique-local (fc00::/8 + fd00::/8)
BLOCKED.addSubnet("fe80::", 10, "ipv6"); // link-local
BLOCKED.addSubnet("fec0::", 10, "ipv6"); // site-local: deprecated, still routable on kit that predates it
BLOCKED.addSubnet("ff00::", 8, "ipv6"); // multicast

/**
 * Pure. Fails closed: an address `isIP` does not recognise, or a family that is
 * neither 4 nor 6, counts as blocked — `BlockList.check()` would answer false.
 *
 * A v4-mapped IPv6 address needs no rule of its own: `BlockList` applies the
 * IPv4 rules to it as long as the family says `"ipv6"`, and a v4-mapped
 * *public* address is legitimately reachable.
 */
export function isBlockedAddress(address: string, family: number): boolean {
  const kind = family === 4 ? "ipv4" : family === 6 ? "ipv6" : null;
  if (kind === null) return true;
  if (isIP(address) === 0) return true;
  return BLOCKED.check(address, kind);
}

export type UrlShape =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; reason: UrlRejectionReason; detail: string };

/** Everything decidable from the text alone. Synchronous, no DNS. */
export function checkPublicUrlShape(raw: string): UrlShape {
  if (raw.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      reason: "too-long",
      detail: `the URL is longer than ${MAX_URL_LENGTH} characters`,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not-a-url", detail: "the value is not a URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "scheme", detail: "the scheme must be https" };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "credentials",
      detail: "the URL must not contain a username or password",
    };
  }

  // `URL` keeps the brackets around an IPv6 literal.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    return {
      ok: false,
      reason: "ip-literal",
      detail: "the host must be a DNS name, not an IP address",
    };
  }

  // `URL` lowercases the host already; the trailing dot survives and would
  // defeat a plain `endsWith` on the suffix list.
  const hostname = host.toLowerCase().replace(/\.$/, "");
  if (hostname === "") {
    return { ok: false, reason: "not-a-url", detail: "the value is not a URL" };
  }
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return {
      ok: false,
      reason: "internal-name",
      detail: `"${hostname}" is a private or internal name`,
    };
  }

  return { ok: true, url, hostname };
}

export type ResolvedAddress = { address: string; family: number };
export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export type UrlCheck =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; reason: UrlRejectionReason; detail: string; hostname?: string };

export type CheckPublicHttpsUrlOptions = {
  lookup?: AddressLookup;
  timeoutMs?: number;
};

/**
 * The shape checks plus hostname resolution. Never throws for a bad URL — the
 * `AppError` mapping is `assertPublicUrl`'s job.
 *
 * The timeout is a race, not a cancellation: `getaddrinfo` keeps its libuv
 * threadpool slot until the OS resolver gives up. It bounds our wait, not the
 * work, which is one reason callers resolve once per deployment per tick rather
 * than once per request.
 */
export async function checkPublicHttpsUrl(
  raw: string,
  opts: CheckPublicHttpsUrlOptions = {},
): Promise<UrlCheck> {
  const shape = checkPublicUrlShape(raw);
  if (!shape.ok) return shape;

  const lookup = opts.lookup ?? ((host: string) => dnsLookup(host, { all: true, verbatim: true }));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;

  let records: ResolvedAddress[];
  try {
    records = await withTimeout(lookup(shape.hostname), timeoutMs);
  } catch (err) {
    const timedOut = err instanceof ResolveTimeout;
    return {
      ok: false,
      reason: timedOut ? "resolve-timeout" : "unresolvable",
      detail: timedOut
        ? `"${shape.hostname}" could not be resolved in time`
        : `"${shape.hostname}" could not be resolved`,
      hostname: shape.hostname,
    };
  }

  if (records.length === 0 || records.some((r) => isBlockedAddress(r.address, r.family))) {
    // The resolved address is deliberately not reported: a tenant who owns the
    // name already knows it, and one pointing at `redis.railway.internal` would
    // otherwise be handed the internal topology this check exists to hide.
    return {
      ok: false,
      reason: records.length === 0 ? "unresolvable" : "private-address",
      detail:
        records.length === 0
          ? `"${shape.hostname}" could not be resolved`
          : `"${shape.hostname}" resolves to a private or reserved address`,
      hostname: shape.hostname,
    };
  }

  return { ok: true, url: shape.url, hostname: shape.hostname };
}

class ResolveTimeout extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ResolveTimeout()), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
