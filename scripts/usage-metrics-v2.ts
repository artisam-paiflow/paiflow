import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { usageReport } from "@/lib/analytics/report";
import { UsageReportSchema } from "@/lib/analytics/report-schema";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
async function main() {
  const { values } = parseArgs({
    options: {
      start: { type: "string" },
      end: { type: "string" },
      network: { type: "string" },
      audience: { type: "string" },
      output: { type: "string" },
    },
  });
  try {
    const report = await usageReport(
      UsageReportSchema.parse({
        start: values.start,
        end: values.end,
        network: values.network,
        audience: values.audience,
      }),
    );
    await writeFile(
      values.output ?? "usage-v2-report.json",
      JSON.stringify(report, null, 2) + "\n",
      {
        flag: "wx",
      },
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.exitCode = 1;
  const code = error && typeof error === "object" && "code" in error ? error.code : "REPORT_FAILED";
  log.error(
    { code },
    "usage-v2 report failed; check arguments, output path and database configuration",
  );
});
