import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ConfigPanel cannot be rendered under vitest (CLAUDE.md §12), so this reads
// its source: #407 was an AssetField call site with no `error`, and a new
// node type's call site would repeat it silently.
describe("ConfigPanel's AssetField call sites (#407)", () => {
  it("every AssetField is given the node's asset error", () => {
    const src = readFileSync(join(process.cwd(), "components/builder/config-panel.tsx"), "utf8");
    const sites = src.split(/<(?:Node)?AssetField\b/).slice(1);
    expect(sites.length).toBeGreaterThanOrEqual(10);
    for (const site of sites) {
      const props = site.slice(0, site.indexOf("/>"));
      expect(props).toContain("error={assetError}");
    }
  });
});
