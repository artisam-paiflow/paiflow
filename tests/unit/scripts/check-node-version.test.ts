import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const check = resolve("scripts/check-node-version.cjs");

describe("Node runtime requirement", () => {
  it.each([
    ["22.14.0", false],
    ["22.23.3", false],
    ["22.23.4", true],
    ["22.23.5", true],
    ["22.24.0", true],
    ["22.23.4-rc.1", false],
    ["22.24.0-pre", false],
    ["22.24", false],
    ["23.0.0", false],
    ["24.22.1", false],
  ])("checks Node %s before application code runs", (version, accepted) => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} }); require(${JSON.stringify(check)});`,
      ],
      { encoding: "utf8" },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(accepted ? 0 : 1);
    if (accepted) {
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Node.js runtime:");
    } else {
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Node.js ${version} is unsupported`);
    }
  });

  it.each([undefined, -99])("rejects a supported Node version with Brotli marker %s", (marker) => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `Object.defineProperty(process.versions, "node", { value: "22.23.4" });
           const Module = require("node:module");
           const load = Module._load;
           Module._load = function(id, ...rest) {
             return id === "node:zlib"
               ? { constants: { BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH: ${String(marker)} } }
               : Reflect.apply(load, this, [id, ...rest]);
           };
           require(${JSON.stringify(check)});`,
      ],
      { encoding: "utf8" },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("lacks the expected Brotli block-switch error marker");
  });
});
