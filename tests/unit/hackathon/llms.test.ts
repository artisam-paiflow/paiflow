import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
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
  it("reports non-JSON HTTP failures with the request id in the documented helper", () => {
    const helper = guide.match(/```ts\n(import "server-only";[\s\S]*?)\n```/)?.[1];
    expect(helper).toBeDefined();
    const code = transpileModule(helper!.replace('import "server-only";', ""), {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    execFileSync(process.execPath, ["--input-type=module"], {
      input: `
        import assert from "node:assert/strict";
        ${code}
        process.env.PAIFLOW_BASE_URL = "https://beta.app.paiflow.xyz";
        process.env.PAIFLOW_DEPLOYMENT_ID = "test-deployment";
        process.env.PAIFLOW_API_TOKEN = "test-token";
        for (const requestId of ["proxy-request-123", null]) {
          globalThis.fetch = async () => new Response("<html>Bad gateway</html>", {
            status: 502,
            headers: requestId ? { "x-request-id": requestId } : {},
          });
          await assert.rejects(prepareExecute({ from: "test-account", amount: "1" }), {
            message: "Unexpected Paiflow HTTP 502" +
              (requestId ? " (x-request-id: " + requestId + ")" : ""),
          });
        }
        globalThis.fetch = async () => Response.json({ data: { xdr: "prepared" } });
        assert.deepEqual(await prepareExecute({ from: "test-account", amount: "1" }), { xdr: "prepared" });
        globalThis.fetch = async () => Response.json({ error: { code: "RATE_LIMITED", message: "Slow down" } }, {
          status: 429, headers: { "x-request-id": "api-request-123", "Retry-After": "60" },
        });
        await assert.rejects(prepareExecute({ from: "test-account", amount: "1" }), (error) => {
          assert.ok(error instanceof PaiflowError);
          assert.equal(error.status, 429);
          assert.equal(error.requestId, "api-request-123");
          assert.equal(error.retryAfter, "60");
          return true;
        });
      `,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

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
