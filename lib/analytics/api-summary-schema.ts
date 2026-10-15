import { z } from "zod";
import { AUDIENCES } from "./policy";

export class ApiSummaryError extends Error {}
export const API_COUNT_METRICS = [
  "requests",
  "errors",
  "authentication_failures",
  "rate_limited",
  "total_duration_ms",
] as const;
const count = z.string().regex(/^\d+$/);
export const ApiSummaryTotalsSchema = z.object({
  requests: count,
  errors: count,
  authentication_failures: count,
  rate_limited: count,
  total_duration_ms: count,
  mean_duration_ms: z.number().finite().nonnegative().nullable(),
  min_duration_ms: z.number().int().nonnegative().nullable(),
  max_duration_ms: z.number().int().nonnegative().nullable(),
  newest_request: z.string().datetime().nullable(),
});
export const ApiSummaryInputSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    network: z.enum(["testnet", "mainnet"]),
    audience: z.enum(AUDIENCES),
    environment: z.string().min(1).max(40),
  })
  .strict()
  .refine((value) => Date.parse(value.start) < Date.parse(value.end), "Start must precede end");
export const ApiSummarySchema = z
  .object({
    query_version: z.literal(1),
    tracking_version: z.literal("api-requests-v1"),
    environment: z.string().min(1).max(40),
    start: z.string().datetime(),
    end: z.string().datetime(),
    coverage_from: z.string().datetime(),
    generated_at: z.string().datetime(),
    totals: ApiSummaryTotalsSchema,
    endpoints: z
      .array(
        ApiSummaryTotalsSchema.extend({
          endpoint: z.string().min(1).max(300),
          method: z.string().min(1).max(20),
        }),
      )
      .max(1000),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.start) >= Date.parse(value.end))
      ctx.addIssue({ code: "custom", message: "Empty API window", path: ["end"] });
    const keys = value.endpoints.map((row) => JSON.stringify([row.method, row.endpoint]));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Duplicate API endpoint", path: ["endpoints"] });
  });
export type ApiSummary = z.infer<typeof ApiSummarySchema>;
