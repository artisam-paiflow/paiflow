import { globSync } from "node:fs";
import { matchesGlob } from "node:path";
import { describe, expect, it } from "vitest";
import config from "@/vitest.config";

// vitest runs only the files a project's `include` matches and skips the rest
// without a warning, which is how .test.tsx files once passed by unrun. Every
// test file under tests/unit must land in exactly one project.
function projectIncludes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const project of config.test?.projects ?? []) {
    if (typeof project !== "object" || !("test" in project) || !project.test) continue;
    const { name, include } = project.test;
    if (typeof name !== "string" || !include) continue;
    out[name] = include;
  }
  return out;
}

const testFiles = globSync("tests/unit/**/*.test.{ts,tsx}");

describe("vitest projects", () => {
  const includes = projectIncludes();

  it("defines the node and dom projects", () => {
    expect(Object.keys(includes).sort()).toEqual(["dom", "node"]);
  });

  it("finds the test files it is checking", () => {
    expect(testFiles.some((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(testFiles.some((f) => f.endsWith(".test.tsx"))).toBe(true);
  });

  it.each(testFiles)("%s is picked up by exactly one project", (file) => {
    const owners = Object.entries(includes)
      .filter(([, globs]) => globs.some((g) => matchesGlob(file, g)))
      .map(([name]) => name);
    expect(owners).toHaveLength(1);
  });

  it("runs .tsx files in the dom project", () => {
    for (const file of testFiles.filter((f) => f.endsWith(".tsx"))) {
      expect(includes.dom?.some((g) => matchesGlob(file, g))).toBe(true);
    }
  });
});
