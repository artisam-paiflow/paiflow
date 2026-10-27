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
        .replace(/\[([A-Za-z0-9_]+)\]/g, ":$1"),
    ),
);

describe("hackathon AI context pack", () => {
  it("preserves SDK errors and refuses unsupported payment deployments", () => {
    const helper = guide.match(/```ts\n(import "server-only";[\s\S]*?)\n```/)?.[1];
    expect(helper).toBeDefined();
    const code = transpileModule(helper!.replace('import "server-only";', ""), {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    execFileSync(process.execPath, ["--input-type=module"], {
      input: `
        import assert from "node:assert/strict";
        ${code}
        let calls = 0;
        const capability = { network: "testnet", inputAsset: { kind: "native" }, triggerType: "deposit", operations: { execute: { status: "supported" } } };
        const failure = Object.assign(new Error("Uncertain SDK response"), {
          status: 502, metadata: { requestId: "sdk-request-123", retryAfter: "60" },
        });
        const deployment = {
          capabilities: { get: async () => ({ data: capability }) },
          execute: { prepare: async () => { calls++; throw failure; } },
        };
        await assert.rejects(prepareExecute(deployment, "customer"), error => error === failure);
        assert.equal(calls, 1);
        capability.network = "mainnet";
        await assert.rejects(prepareExecute(deployment, "customer"));
        capability.network = "testnet";
        capability.inputAsset.kind = "known";
        await assert.rejects(prepareExecute(deployment, "customer"));
        capability.inputAsset.kind = "native";
        capability.operations.execute.status = "unsupported";
        await assert.rejects(prepareExecute(deployment, "customer"));
        assert.equal(calls, 1);
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
