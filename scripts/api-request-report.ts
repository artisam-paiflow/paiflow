import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "dotenv";
import { ApiDailyReportError } from "@/lib/api/request-history/daily-schema";
async function main() {
  const { values } = parseArgs({
    options: {
      start: { type: "string" },
      end: { type: "string" },
      network: { type: "string" },
      audience: { type: "string" },
      environment: { type: "string" },
      output: { type: "string" },
      daily: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "pnpm analytics:api-report [--daily] --start DATE --end DATE --network testnet|mainnet --audience INTERNAL|EXTERNAL|SANDBOX|UNCLASSIFIED --environment beta --output FILE\nRaw mode: ISO timestamps, retained 30 days. --daily: UTC YYYY-MM-DD dates, durable endpoint totals without identities or p50/p95. End is exclusive.\n",
    );
    return;
  }
  config({ path: ".env.local" });
  config({ path: ".env" });
  const { db } = await import("@/lib/db");
  let disconnectRedis: (() => void) | undefined;
  try {
    const { output, daily, help: _help, ...input } = values;
    const report = daily
      ? await (
          await import("@/lib/api/request-history/daily-report")
        ).apiDailyReport(
          (await import("@/lib/api/request-history/daily-schema")).ApiDailyReportSchema.parse(
            input,
          ),
        )
      : await (async () => {
          const { redis } = await import("@/lib/redis");
          disconnectRedis = () => redis()?.disconnect();
          const { apiRequestReport } = await import("@/lib/api/request-history/report");
          const { ApiRequestReportSchema } = await import("@/lib/api/request-history/schema");
          return apiRequestReport(ApiRequestReportSchema.parse(input));
        })();
    const filename = output ?? (daily ? "api-requests-daily-v1.json" : "api-requests-v1.json");
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.stdout.write(`Saved API report: ${filename}\n`);
  } finally {
    await db.$disconnect();
    disconnectRedis?.();
  }
}
void main().catch((error: unknown) => {
  process.exitCode = 1;
  if (error instanceof ApiDailyReportError) process.stderr.write(error.message + "\n");
  process.stderr.write(
    "API request report failed; check arguments, migrations, coverage window, output path and database access. See --help.\n",
  );
});
