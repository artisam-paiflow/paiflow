import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pinned Lantern module provenance", () => {
  it("preserves the published import-free upstream source and MIT attribution", () => {
    const source = readFileSync("lib/stellar/vendor/lantern/lantern.module.ts");
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "0b319c8dfea5f231d62eb62e93f1c4186b902a971b609c62b0ff69d1d7a473cb",
    );
    expect(source.toString()).not.toMatch(/^import\s/m);
    expect(readFileSync("lib/stellar/vendor/lantern/LICENSE", "utf8")).toContain(
      "Copyright (c) 2026 Lantern contributors",
    );
  });
});
