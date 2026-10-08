import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { apiRequestReport } from "@/lib/api/request-history/report";
import { ApiRequestReportSchema } from "@/lib/api/request-history/schema";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";
async function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["start", "end", "network", "audience", "environment", "output"].map((key) => [
        key,
        { type: "string" as const },
      ]),
    ),
  });
  try {
    const { output, ...input } = values;
    const report = await apiRequestReport(ApiRequestReportSchema.parse(input));
    await writeFile(
      typeof output === "string" ? output : "api-requests-v1.json",
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    await db.$disconnect();
    redis()?.disconnect();
  }
}
void main().catch(() => {
  process.exitCode = 1;
  log.error(
    { code: "REPORT_FAILED" },
    "API request report failed; check arguments and DB configuration",
  );
});
