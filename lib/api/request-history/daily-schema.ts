import { z } from "zod";
import { AUDIENCES } from "@/lib/analytics/policy";

export const API_DAILY_VERSION = "api-requests-daily-v1";
/** Script diagnostics without importing application auth/logger configuration. */
export class ApiDailyReportError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "VALIDATION",
    message: string,
  ) {
    super(message);
  }
}
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, "Use a real UTC date in YYYY-MM-DD format");

export const ApiDailyReportSchema = z
  .object({
    start: DaySchema,
    end: DaySchema,
    network: z.enum(["testnet", "mainnet"]),
    audience: z.enum(AUDIENCES),
    environment: z.string().min(1).max(40),
  })
  .strict()
  .refine((value) => {
    const start = Date.parse(value.start),
      end = Date.parse(value.end);
    return start < end && end - start <= 3660 * 86400000;
  }, "Choose an increasing window of at most 3660 UTC days");
export type ApiDailyReportInput = z.infer<typeof ApiDailyReportSchema>;
