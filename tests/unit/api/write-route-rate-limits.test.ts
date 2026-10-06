import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// #371: every mutating route handler must apply a rate limit, so a new route cannot skip it quietly.

const API_DIR = path.join(process.cwd(), "app", "api");
const MUTATING = ["POST", "PATCH", "PUT", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** What counts as "this handler applies a limit". */
const LIMITERS = [
  /\benforceWriteRateLimit\(/,
  /\benforceRateLimit\(/,
  /\brateLimit\(/,
  /\bv1Route\(/, // lib/api/v1/handler.ts: per-token limit plus the pre-auth address guards
  /\brequireTokenManager\(/, // lib/api/v1/tokens.ts enforces `api-tokens:<user>` before anything else
];

/**
 * Handlers that legitimately carry no limiter, keyed "METHOD relative/path", with the reason.
 * Keep this short: a new entry needs a real argument, not convenience.
 */
const ALLOWLIST: Record<string, string> = {
  // Credential sign-in is limited inside `authorize` (lib/auth.ts): 10 attempts per username per
  // 10 minutes, plus the 5-failure account lockout. A per-address bucket here would lock a shared
  // venue out.
  "POST app/api/auth/[...nextauth]/route.ts": "limited per username in lib/auth.ts authorize()",
};

/** Cron routes are gated by the shared CRON_SECRET (fail-closed in production), not by a bucket. */
const CRON_GUARD = /\brequireCronSecret\(/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function handlers(source: string): Array<{ method: string; body: string }> {
  const starts: Array<{ method: string; index: number }> = [];
  for (const m of source.matchAll(
    /^export\s+(?:(?:async\s+)?function|const|let)\s+(POST|PATCH|PUT|DELETE|GET|HEAD|OPTIONS)\b/gm,
  )) {
    starts.push({ method: m[1]!, index: m.index! });
  }
  // `export const { GET, POST } = handlers` style re-exports have no body to inspect.
  for (const m of source.matchAll(/^export\s+const\s+\{([^}]*)\}/gm)) {
    for (const name of m[1]!.split(",").map((s) => s.trim())) {
      if ((MUTATING as readonly string[]).includes(name)) {
        starts.push({ method: name, index: m.index! });
      }
    }
  }
  starts.sort((a, b) => a.index - b.index);
  return starts.map((s, i) => ({
    method: s.method,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length),
  }));
}

describe("mutating API routes are rate limited (#371)", () => {
  const files = routeFiles(API_DIR);
  const seenAllowlisted = new Set<string>();

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("refuses re-exported handlers it cannot inspect", () => {
    for (const file of files) {
      expect(
        readFileSync(file, "utf8"),
        `${file}: export { x as POST } hides the handler from this guard`,
      ).not.toMatch(/^export\s*\{[^}]*\bas\s+(POST|PATCH|PUT|DELETE)\b/m);
    }
  });

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const source = stripComments(readFileSync(file, "utf8"));
    const found = handlers(source);
    for (const key of Object.keys(ALLOWLIST)) {
      if (key.endsWith(` ${rel}`)) seenAllowlisted.add(key);
    }
    for (const h of found) {
      if (!(MUTATING as readonly string[]).includes(h.method)) continue;
      it(`${h.method} ${rel}`, () => {
        if (ALLOWLIST[`${h.method} ${rel}`]) return;
        if (CRON_GUARD.test(h.body)) return;
        expect(
          LIMITERS.some((re) => re.test(h.body)),
          `${h.method} ${rel} applies no rate limit: call enforceWriteRateLimit() (lib/api/write-rate-limit.ts)`,
        ).toBe(true);
      });
    }
  }

  it("has no stale allowlist entries", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      expect(seenAllowlisted.has(key), `${key} names no route file`).toBe(true);
    }
  });
});
