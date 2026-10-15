import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { saveSnapshot } from "@/lib/analytics/snapshot-store";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "analytics-store-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("publishes complete private JSON and removes the temporary file", async () => {
  await saveSnapshot(directory, "snapshot-test.json", { totals: { count: "2" } });
  expect(JSON.parse(await readFile(join(directory, "snapshot-test.json"), "utf8"))).toEqual({
    totals: { count: "2" },
  });
  expect(await readdir(directory)).toEqual(["snapshot-test.json"]);
  expect((await stat(join(directory, "snapshot-test.json"))).mode & 0o777).toBe(0o600);
});

it("never replaces a baseline and cleans up a failed publication", async () => {
  await saveSnapshot(directory, "snapshot-test.json", { first: true });
  await expect(
    saveSnapshot(directory, "snapshot-test.json", { first: false }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(JSON.parse(await readFile(join(directory, "snapshot-test.json"), "utf8"))).toEqual({
    first: true,
  });
  expect(await readdir(directory)).toEqual(["snapshot-test.json"]);
});

it("publishes no history file when serialization fails", async () => {
  await expect(saveSnapshot(directory, "snapshot-test.json", { invalid: 1n })).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});
