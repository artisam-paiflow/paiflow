/**
 * pnpm analytics:snapshot --network testnet --audience EXTERNAL
 * Optional: --start <ISO timestamp> --end <ISO timestamp> --dir <history directory>
 * Start defaults to the usage-v2 cutover; end defaults to now. Keep start fixed
 * across runs to compare cumulative totals. History defaults to reports/analytics.
 */
import { parseArgs } from "node:util";
import { mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { config } from "dotenv";
import {
  compareSnapshots,
  latestCompatibleSnapshot,
  SavedSnapshotSchema,
  SnapshotReportSchema,
} from "@/lib/analytics/snapshot";
import { UsageReportSchema } from "@/lib/analytics/report-schema";
import { TRACKING_VERSION } from "@/lib/analytics/policy";

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      network: { type: "string" },
      audience: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      dir: { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "pnpm analytics:snapshot --network testnet|mainnet --audience INTERNAL|EXTERNAL|SANDBOX|UNCLASSIFIED [--start ISO] [--end ISO] [--dir reports/analytics]",
    );
    console.log(
      "Keep start fixed across runs. Use a separate --dir for each database. The first run saves a baseline; subsequent runs show net changes.",
    );
    return;
  }
  // Shell settings take precedence over local files.
  config({ path: ".env.local" });
  config({ path: ".env" });
  const { db } = await import("@/lib/db");
  let lock;
  let lockPath: string | undefined;
  try {
    const policy = await db.analyticsPolicy.findUniqueOrThrow({
      where: { version: TRACKING_VERSION },
    });
    const input = UsageReportSchema.parse({
      network: values.network,
      audience: values.audience,
      start: values.start ?? policy.activatedAt.toISOString(),
      end: values.end ?? new Date().toISOString(),
    });
    if (Date.parse(input.end) > Date.now()) throw new Error("End must not be in the future");
    const directory = resolve(values.dir ?? "reports/analytics");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    lockPath = join(directory, ".snapshot.lock");
    lock = await open(lockPath, "wx", 0o600);
    const { usageReport } = await import("@/lib/analytics/report");
    const report = SnapshotReportSchema.parse(await usageReport(input));
    const history = [];
    for (const name of await readdir(directory)) {
      if (!/^snapshot-.*\.json$/.test(name)) continue;
      const saved = SavedSnapshotSchema.parse(
        JSON.parse(await readFile(join(directory, name), "utf8")),
      );
      history.push({ name, report: saved.report });
    }
    const previous = latestCompatibleSnapshot(
      report,
      history.map((entry) => entry.report),
    );
    const comparison = previous ? compareSnapshots(report, previous) : null;
    const baseline = previous ? history.find((entry) => entry.report === previous)!.name : null;
    const filename = `snapshot-${report.generated_at.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const snapshot = {
      snapshot_version: 1,
      report,
      baseline,
      comparison,
      comparison_note:
        "Net changes to cumulative totals, including outcome updates to older attempts. Unique accounts and addresses are not people. Outcomes are as of generation time; missing historical tracking is not reconstructed.",
    };
    await writeFile(join(directory, filename), JSON.stringify(snapshot, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Saved: ${join(directory, filename)}`);
    console.log(`${report.network} / ${report.audience}: ${report.start} → ${report.end}`);
    console.log(
      baseline ? `Compared with: ${baseline}` : "First compatible snapshot: baseline saved.",
    );
    console.table(
      comparison ??
        Object.fromEntries(
          Object.entries(report.totals).map(([key, value]) => [key, { current: value }]),
        ),
    );
    console.log(snapshot.comparison_note);
  } finally {
    if (lock) {
      await lock.close();
      await unlink(lockPath!);
    }
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error(
    "Snapshot failed. Check arguments, database access, and history files. If .snapshot.lock exists, ensure no snapshot process is running before removing it.",
  );
  process.exitCode = 1;
});
