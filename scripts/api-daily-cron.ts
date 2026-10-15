import { parseArgs } from "node:util";
import { config } from "dotenv";
import { ApiDailyReportError } from "@/lib/api/request-history/daily-schema";
import { dailyCronPlan, runDailyCron } from "./api-daily-cron-utils";

async function main() {
  const { values } = parseArgs({
    options: {
      network: { type: "string" },
      environment: { type: "string" },
      audience: { type: "string" },
      dir: { type: "string" },
      "lookback-days": { type: "string", default: "3" },
      day: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "pnpm analytics:api-daily-cron --network testnet|mainnet --environment beta --audience INTERNAL|EXTERNAL|SANDBOX|UNCLASSIFIED --dir PATH [--lookback-days 1..31] [--day YYYY-MM-DD]\nExports the last 3 completed UTC days by default. --day exports one historical UTC day. Each run saves new revisions; no snapshot deltas.\n",
    );
    return;
  }
  const input = {
    network: values.network,
    environment: values.environment,
    audience: values.audience,
    dir: values.dir,
    day: values.day,
    lookbackDays: values["lookback-days"],
  };
  const now = new Date();
  dailyCronPlan(input, now); // Validate before opening the database.
  config({ path: ".env.local" });
  config({ path: ".env" });
  const { db } = await import("@/lib/db");
  try {
    const { apiDailyReport } = await import("@/lib/api/request-history/daily-report");
    for (const file of await runDailyCron(input, apiDailyReport, now))
      process.stdout.write(`Saved daily API report: ${file}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.exitCode = 1;
  if (error instanceof ApiDailyReportError) process.stderr.write(error.message + "\n");
  process.stderr.write(
    "Daily API reporting failed; check arguments, coverage, SELECT access and volume storage. See --help.\n",
  );
});
