import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  ApiDailyReportSchema,
  type ApiDailyReportInput,
} from "@/lib/api/request-history/daily-schema";

const ScopeSchema = z.object({
  network: z.enum(["testnet", "mainnet"]),
  audience: z.enum(["INTERNAL", "EXTERNAL", "SANDBOX", "UNCLASSIFIED"]),
  // This becomes a path segment; never allow separators or dot traversal.
  environment: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  dir: z.string().min(1),
  lookbackDays: z.coerce.number().int().min(1).max(31).default(3),
  day: z.string().optional(),
});

export function dailyCronPlan(input: unknown, now = new Date()) {
  const options = ScopeSchema.parse(input);
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const lastDay = options.day
    ? new Date(options.day + "T00:00:00Z")
    : new Date(today.getTime() - 86400000);
  if (
    !Number.isFinite(lastDay.getTime()) ||
    lastDay >= today ||
    (options.day !== undefined && lastDay.toISOString().slice(0, 10) !== options.day)
  )
    throw new Error("Choose a completed UTC day");
  const dayCount = options.day ? 1 : options.lookbackDays;
  const reports: ApiDailyReportInput[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset--) {
    const start = new Date(lastDay.getTime() - offset * 86400000).toISOString().slice(0, 10);
    const end = new Date(lastDay.getTime() - (offset - 1) * 86400000).toISOString().slice(0, 10);
    reports.push(
      ApiDailyReportSchema.parse({
        network: options.network,
        audience: options.audience,
        environment: options.environment,
        start,
        end,
      }),
    );
  }
  return { options, reports };
}

export async function runDailyCron(
  input: unknown,
  query: (input: ApiDailyReportInput) => Promise<unknown>,
  now = new Date(),
) {
  const { options, reports } = dailyCronPlan(input, now);
  const files: string[] = [];
  const revision = now.toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
  for (const request of reports) {
    const report = await query(request);
    const directory = join(
      options.dir,
      options.environment,
      options.network,
      options.audience,
      request.start,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, revision + ".json");
    const temporary = filename + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
    files.push(filename);
  }
  return files;
}
