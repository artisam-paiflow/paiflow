/**
 * pnpm analytics:snapshot --env-file .env.analytics.local
 * Optional: --start <ISO timestamp> --end <ISO timestamp> --dir <history directory>
 * Start defaults to the usage-v2 cutover; end defaults to now. Keep start fixed
 * across runs to compare cumulative totals. Defaults target staging/testnet,
 * EXTERNAL, with API analytics and host-scoped PostHog enabled. Output defaults
 * beside --env-file, or reports/analytics-staging without an explicit env file.
 */
import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { ZodError } from "zod";
import {
  compareSnapshots,
  comparePosthogSnapshots,
  compareApiSnapshots,
  latestCompatibleSnapshot,
  SavedSnapshotSchema,
  SnapshotReportSchema,
} from "@/lib/analytics/snapshot";
import { UsageReportError, UsageReportSchema } from "@/lib/analytics/report-schema";
import { TRACKING_VERSION } from "@/lib/analytics/policy";
import { PosthogReportError, PosthogScopeSchema } from "@/lib/analytics/posthog-report-schema";
import { loadSnapshotEnvironment } from "@/lib/env";
import { saveSnapshot } from "@/lib/analytics/snapshot-store";
import { snapshotOptions } from "@/lib/analytics/snapshot-options";
import { API_COUNT_METRICS, ApiSummaryError } from "@/lib/analytics/api-summary-schema";

function print(line: string) {
  process.stdout.write(line + "\n");
}
function printCounts(
  totals: Record<string, string | undefined>,
  comparison: Record<string, { previous: string; current: string; delta: string }> | null,
) {
  const rows = comparison
    ? [
        "Metric\tPrevious\tCurrent\tDelta",
        ...Object.entries(comparison).map(
          ([metric, values]) => `${metric}\t${values.previous}\t${values.current}\t${values.delta}`,
        ),
      ]
    : [
        "Metric\tCurrent",
        ...Object.entries(totals).map(([metric, value]) => `${metric}\t${value}`),
      ];
  process.stdout.write(rows.join("\n") + "\n");
}

async function main() {
  const values = snapshotOptions(process.argv.slice(2));
  if (values.help) {
    print(
      "pnpm analytics:snapshot [--env-file PATH] [--network testnet|mainnet] [--audience INTERNAL|EXTERNAL|SANDBOX|UNCLASSIFIED] [--start ISO] [--end ISO] [--dir PATH] [--no-posthog] [--no-api] [--app-env beta|staging|local] [--app-host HOST]",
    );
    process.stdout.write(
      "Defaults: testnet, EXTERNAL, output beside --env-file (otherwise reports/analytics-staging), PostHog enabled, app-env beta, app-host beta.app.paiflow.xyz. --dir overrides the output/history directory. PostHog requires a personal API key with query:read access. Old DB-only snapshots remain usable; the first PostHog run establishes its own baseline.\n",
    );
    print(
      "API analytics enabled by default: --app-env filters API environment. Completed UTC days use durable aggregates; the final partial day uses raw history. API starts at the first fully covered UTC day on/after --start. Requires the daily aggregate migration and SELECT grants; --no-api skips it. First API run establishes its own baseline.",
    );
    print(
      "Keep start fixed across runs. Use a separate --dir for each database. The first run saves a baseline; subsequent runs show net changes.",
    );
    print(
      "--env-file reads DATABASE_URL, POSTHOG_PERSONAL_API_KEY and optional POSTHOG_PROJECT_ID/POSTHOG_API_HOST from that file exclusively. Without it: shell > .env.local > .env. No application AUTH_SECRET is needed.",
    );
    return;
  }
  loadSnapshotEnvironment(values["env-file"], values.posthog);
  const posthogScope = values.posthog
    ? PosthogScopeSchema.parse({ app_env: values["app-env"], app_host: values["app-host"] })
    : undefined;
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
    const directory = resolve(values.dir);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    lockPath = join(directory, ".snapshot.lock");
    lock = await open(lockPath, "wx", 0o600);
    const { usageReport } = await import("@/lib/analytics/report");
    const usage = await usageReport(input);
    const api = values.api
      ? await (
          await import("@/lib/analytics/api-summary")
        ).apiSummary({ ...input, environment: values["app-env"] })
      : undefined;
    const posthog = posthogScope
      ? await (await import("@/lib/analytics/posthog-report")).posthogSummary(input, posthogScope)
      : undefined;
    const report = SnapshotReportSchema.parse({
      ...usage,
      ...(posthog ? { posthog } : {}),
      ...(api ? { api } : {}),
    });
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
    const posthogPrevious = history
      .filter((entry) => comparePosthogSnapshots(report, entry.report) !== null)
      .sort((a, b) => Date.parse(b.report.generated_at) - Date.parse(a.report.generated_at))[0];
    const posthogComparison = posthogPrevious
      ? comparePosthogSnapshots(report, posthogPrevious.report)
      : null;
    const apiPrevious = history
      .filter((entry) => compareApiSnapshots(report, entry.report) !== null)
      .sort((a, b) => Date.parse(b.report.generated_at) - Date.parse(a.report.generated_at))[0];
    const apiComparison = apiPrevious ? compareApiSnapshots(report, apiPrevious.report) : null;
    const filename = `snapshot-${report.generated_at.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const snapshot = {
      snapshot_version: 1,
      report,
      baseline,
      comparison,
      ...(api
        ? {
            api_baseline: apiPrevious?.name ?? null,
            api_comparison: apiComparison,
            api_note:
              "API counts cover persisted wrapped responses by endpoint/method, including SDK requests using those routes. UTC start is rounded forward to the first fully covered day on/after the requested start and aggregate coverage. The final partial day ends at the snapshot cutoff. Completed days use durable totals; late telemetry can change older counts. No host filter, individual request records, identities, unique users or p50/p95. Latency is handler duration, not client round-trip time. Count deltas are net cumulative changes; latency shows previous/current cumulative statistics, not interval latency. Queued/dropped requests are excluded.",
          }
        : {}),
      ...(posthog
        ? {
            posthog_baseline: posthogPrevious?.name ?? null,
            posthog_comparison: posthogComparison,
            posthog_note:
              "Aggregate event counts and distinct authenticated account IDs for the selected usage-v2 events. Event counts are not ordered funnels or confirmed transaction totals. Newly observed accounts are not all accounts active since the last run. Missing/blocked events and delivery delays can undercount activity; historical data may arrive late. API request events are excluded. Host-scoped PostHog metrics can differ from database totals, which have no host filter.",
          }
        : {}),
      comparison_note:
        "Net changes to cumulative totals, including outcome updates to older attempts. Unique accounts and addresses are not people. Outcomes are as of generation time; missing historical tracking is not reconstructed.",
    };
    await saveSnapshot(directory, filename, snapshot);
    print(`Saved: ${join(directory, filename)}`);
    print(`${report.network} / ${report.audience}: ${report.start} → ${report.end}`);
    print(baseline ? `Compared with: ${baseline}` : "First compatible snapshot: baseline saved.");
    printCounts(report.totals, comparison);
    print(snapshot.comparison_note);
    if (api) {
      print(`API requests: ${api.environment} / ${api.start} → ${api.end}`);
      print(
        apiPrevious
          ? `Compared with: ${apiPrevious.name}`
          : "First compatible API snapshot: baseline saved.",
      );
      printCounts(
        Object.fromEntries(API_COUNT_METRICS.map((metric) => [metric, api.totals[metric]])),
        apiComparison?.totals.counts ?? null,
      );
      print("Latency (ms)\tPrevious\tCurrent");
      for (const metric of ["mean_duration_ms", "min_duration_ms", "max_duration_ms"] as const)
        print(
          `${metric}\t${apiComparison?.totals.latency[metric]?.previous ?? "n/a"}\t${api.totals[metric] ?? "n/a"}`,
        );
      print(`Latest request: ${api.totals.newest_request ?? "none"}`);
      print("Endpoint/method request counts");
      printCounts(
        Object.fromEntries(
          api.endpoints.map((row) => [`${row.method} ${row.endpoint}`, row.requests]),
        ),
        apiComparison
          ? Object.fromEntries(
              apiComparison.endpoints.map((row) => [
                `${row.method} ${row.endpoint}`,
                row.counts.requests!,
              ]),
            )
          : null,
      );
      print(
        "Endpoint details (all counters, latency, latest request) are saved in report.api.endpoints and api_comparison.endpoints.",
      );
      print(snapshot.api_note!);
    }
    if (posthog) {
      process.stdout.write(`PostHog: ${posthog.app_env} / ${posthog.app_host}\n`);
      process.stdout.write(
        posthogPrevious
          ? `Compared with: ${posthogPrevious.name}\n`
          : "First compatible PostHog snapshot: baseline saved.\n",
      );
      printCounts(posthog.totals, posthogComparison);
      process.stdout.write(snapshot.posthog_note + "\n");
    }
  } finally {
    try {
      if (lock) {
        try {
          await lock.close();
        } finally {
          await unlink(lockPath!);
        }
      }
    } finally {
      await db.$disconnect();
    }
  }
}

void main().catch((error: unknown) => {
  if (
    error instanceof PosthogReportError ||
    error instanceof UsageReportError ||
    error instanceof ApiSummaryError
  ) {
    process.stderr.write(error.message + "\n");
  } else if (error instanceof ZodError) {
    process.stderr.write(
      "Invalid snapshot arguments; check dates, network, audience, paths and PostHog scope. See --help.\n",
    );
  }
  process.stderr.write(
    "Snapshot failed. Check arguments, database access, and history files. If .snapshot.lock exists, ensure no snapshot process is running before removing it.\n",
  );
  process.exitCode = 1;
});
