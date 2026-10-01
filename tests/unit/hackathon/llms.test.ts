import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const guide = readFileSync(path.join(root, "docs/hackathon/llms.md"), "utf8");
const apiRoot = path.join(root, "app/api/v1");
const routes = new Set(
  readdirSync(apiRoot, { recursive: true })
    .filter((file) => typeof file === "string" && path.basename(file) === "route.ts")
    .map((file) =>
      path.posix
        .join("/api/v1", path.dirname(String(file)).split(path.sep).join("/"))
        .replace(/\[id\]/g, ":id"),
    ),
);

describe("hackathon AI context pack", () => {
  it("does not mention disabled surfaces or operator-only tokens", () => {
    expect(guide).not.toMatch(/payroll|off[ -]?ramp|oracle|DevApiToken/i);
  });

  it("names only existing v1 routes (with the namespace allowed in prose)", () => {
    const mentions = [...guide.matchAll(/\/api\/v1(?:\/[A-Za-z0-9_.$:{}\[\]-]+)*/g)].map(([url]) =>
      url
        .replace(/\$DEPLOYMENT_ID|\$\{deploymentId\}|\[id\]|\{id\}/g, ":id")
        // Exact API error sentences can end with a period after the URL.
        .replace(/\.+$/, ""),
    );
    expect(mentions.length).toBeGreaterThan(0);
    for (const url of mentions) {
      if (url === "/api/v1") continue;
      expect(routes.has(url), `Undocumented route in context pack: ${url}`).toBe(true);
    }
  });
});
