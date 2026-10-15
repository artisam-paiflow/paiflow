import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyCronPlan, runDailyCron } from "@/scripts/api-daily-cron-utils";

const scope = { network: "testnet", environment: "beta", audience: "EXTERNAL", dir: "/reports" };
const now = new Date("2026-03-01T01:00:00Z");
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("daily reporting cron", () => {
  it("refreshes three completed UTC days across month boundaries with explicit scopes", () => {
    expect(dailyCronPlan(scope, now).reports).toEqual([
      {
        network: "testnet",
        environment: "beta",
        audience: "EXTERNAL",
        start: "2026-02-26",
        end: "2026-02-27",
      },
      {
        network: "testnet",
        environment: "beta",
        audience: "EXTERNAL",
        start: "2026-02-27",
        end: "2026-02-28",
      },
      {
        network: "testnet",
        environment: "beta",
        audience: "EXTERNAL",
        start: "2026-02-28",
        end: "2026-03-01",
      },
    ]);
  });

  it("supports a single historical day and leap years", () => {
    expect(dailyCronPlan({ ...scope, day: "2024-02-29" }, now).reports[0]).toMatchObject({
      start: "2024-02-29",
      end: "2024-03-01",
    });
    expect(dailyCronPlan({ ...scope, day: "2024-02-29" }, now).reports).toHaveLength(1);
  });

  it.each([
    { day: "2026-02-30" },
    { day: "2026-03-01" },
    { day: "2026-03-02" },
    { day: "bad" },
    { environment: "../beta" },
    { network: undefined },
    { audience: undefined },
    { lookbackDays: "0" },
    { lookbackDays: "32" },
    { lookbackDays: "1.5" },
    { dir: "" },
  ])("rejects invalid scope/window %j before querying", (invalid) => {
    expect(() => dailyCronPlan({ ...scope, ...invalid }, now)).toThrow();
  });

  it("preserves prior reports on reruns and publishes complete JSON revisions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daily-cron-"));
    directories.push(dir);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ requests: "10" })
      .mockResolvedValueOnce({ requests: "12" });
    const options = { ...scope, dir, lookbackDays: 1 };
    const first = await runDailyCron(options, query, now);
    const second = await runDailyCron(options, query, now);
    expect(first[0]).not.toEqual(second[0]);
    expect(JSON.parse(await readFile(first[0]!, "utf8"))).toEqual({ requests: "10" });
    expect(JSON.parse(await readFile(second[0]!, "utf8"))).toEqual({ requests: "12" });
    expect(await readdir(join(dir, "beta", "testnet", "EXTERNAL", "2026-02-28"))).toHaveLength(2);
  });

  it("propagates query failures without saving a fabricated zero report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daily-cron-"));
    directories.push(dir);
    await expect(
      runDailyCron(
        { ...scope, dir },
        async () => {
          throw new Error("coverage");
        },
        now,
      ),
    ).rejects.toThrow("coverage");
    expect(await readdir(dir)).toEqual([]);
  });

  it("fails when report storage cannot be created", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daily-cron-"));
    directories.push(dir);
    await writeFile(join(dir, "blocked"), "file");
    await expect(
      runDailyCron(
        { ...scope, dir: join(dir, "blocked"), lookbackDays: 1 },
        async () => ({ requests: "1" }),
        now,
      ),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["blocked"]);
  });
});
