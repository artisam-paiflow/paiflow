/**
 * #524: `middleware.ts` lists `/api/v1` in `PUBLIC_PATHS`, so a v1 route is closed only if its
 * handler is built by `v1Route`. This walks every `app/api/v1/**\/route.ts` and fails on any
 * exported HTTP handler that is not, unless it is on the allowlist below with a reason.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
// Only imported, never called; the real module pulls in next-auth, which vitest cannot resolve.
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));

import { isV1Route } from "@/lib/api/v1/handler";

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/**
 * Exports that are deliberately not token-bound. Each has no `{id}` and no token to check, and
 * carries its own per-IP limit. Adding to this list is a security decision: say why here.
 */
const NOT_TOKEN_BOUND: Record<string, string> = {
  "demo-token/route.ts POST": "mints a demo token for an anonymous caller; per-IP + global caps",
  "openapi.json/route.ts GET": "the public OpenAPI document; static, per-IP limit",
};

const V1_DIR = path.join(process.cwd(), "app/api/v1");

function routeFiles(): string[] {
  return (fs.readdirSync(V1_DIR, { recursive: true }) as string[])
    .filter((f) => path.basename(f) === "route.ts")
    .map((f) => f.split(path.sep).join("/"))
    .sort();
}

describe("every /api/v1 handler is built by v1Route", () => {
  const files = routeFiles();

  it("finds the v1 routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(file, async () => {
      const mod = (await import(path.join(V1_DIR, file))) as Record<string, unknown>;
      const handlers = HTTP_METHODS.filter((m) => m in mod);
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const key = `${file} ${method}`;
        if (key in NOT_TOKEN_BOUND) {
          expect(isV1Route(mod[method]), `${key} is allowlisted but uses v1Route`).toBe(false);
          continue;
        }
        expect(isV1Route(mod[method]), `${key} must be built with v1Route`).toBe(true);
      }
    });
  }

  it("has no stale allowlist entries", () => {
    for (const key of Object.keys(NOT_TOKEN_BOUND)) {
      const [file] = key.split(" ");
      expect(files).toContain(file);
    }
  });
});
