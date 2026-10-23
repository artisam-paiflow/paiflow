import { z } from "zod";
import { AUDIENCES } from "@/lib/analytics/policy";

export const API_HISTORY_VERSION = "api-requests-v1";
const ENDPOINTS = [
  "capabilities",
  "balances",
  "funding",
  "funding/submit",
  "funding/reconcile",
  "subscription/state",
  "subscription/cancel/prepare",
  "subscription/cancel/submit",
  "subscription/cancel/reconcile",
  "subscription/reactivate/prepare",
  "subscription/reactivate/submit",
  "subscription/reactivate/reconcile",
  "swap-quote",
  "schedule/state",
  "schedule/pause",
  "schedule/pause/submit",
  "schedule/pause/reconcile",
  "schedule/resume",
  "schedule/resume/submit",
  "schedule/resume/reconcile",
  "schedule/retrieve",
  "schedule/retrieve/submit",
  "schedule/retrieve/reconcile",

  "events",
  "execute",
  "execute/submit",
  "payouts",
  "payouts/submit",
  "release-early",
  "transactions/:txHash",
] as const;
export function requestEndpoint(path: string): string {
  if (path === "/api/v1/deployments") return path;
  const suffix = path.split("/").slice(5).join("/");
  const normalized = suffix.startsWith("transactions/") ? "transactions/:txHash" : suffix;
  return ENDPOINTS.includes(normalized as (typeof ENDPOINTS)[number])
    ? `/api/v1/deployments/:id/${normalized}`
    : "/api/v1/deployments/:id/:unknown";
}
export const ApiRequestRecordSchema = z
  .object({
    id: z.string().guid({ error: "Invalid uuid" }),
    requestId: z.string().guid({ error: "Invalid uuid" }),
    occurredAt: z.string().datetime(),
    accountId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    tokenCreatorId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    apiTokenId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    developerApiTokenId: z.string().guid({ error: "Invalid uuid" }).nullable().default(null),
    deploymentId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    txHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    preparationRequestId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    callerType: z.enum(["deployment_token", "developer_token", "unknown"]),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    endpoint: z.enum([
      "/api/v1/deployments",
      "/api/v1/deployments/:id/:unknown",
      ...ENDPOINTS.map((e) => `/api/v1/deployments/:id/${e}`),
    ]),
    status: z.number().int().min(100).max(599),
    durationMs: z.number().int().min(0).max(2147483647),
    errorCode: z
      .enum([
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "VALIDATION",
        "CONFLICT",
        "RATE_LIMITED",
        "UPSTREAM_RPC",
        "INSUFFICIENT_FUNDS",
        "INTERNAL",
        "HTTP_ERROR",
      ])
      .nullable(),
    network: z.enum(["testnet", "mainnet"]),
    environment: z.string().max(40),
    appVersion: z.string().max(80),
    audience: z.enum(AUDIENCES),
    trackingVersion: z.literal(API_HISTORY_VERSION),
  })
  .strict();
export type ApiRequestRecord = z.input<typeof ApiRequestRecordSchema>;
export const ApiRequestReportSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    network: z.enum(["testnet", "mainnet"]),
    audience: z.enum(AUDIENCES),
    environment: z.string().min(1).max(40),
  })
  .strict()
  .refine(
    (v) =>
      new Date(v.start) < new Date(v.end) &&
      new Date(v.end).getTime() - new Date(v.start).getTime() <= 31 * 86400000,
    { message: "Choose an increasing window of at most 31 days", path: ["end"] },
  );
