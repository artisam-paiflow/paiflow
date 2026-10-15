import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { AUDIENCES } from "./policy";
import { PosthogScopeSchema } from "./posthog-report-schema";

export const SnapshotOptionsSchema = z
  .object({
    help: z.boolean().default(false),
    network: z.enum(["testnet", "mainnet"]).default("testnet"),
    audience: z.enum(AUDIENCES).default("EXTERNAL"),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
    dir: z.string().min(1).optional(),
    posthog: z.boolean().default(true),
    api: z.boolean().default(true),
    "env-file": z.string().min(1).optional(),
    "app-env": PosthogScopeSchema.shape.app_env.default("beta"),
    "app-host": PosthogScopeSchema.shape.app_host.default("beta.app.paiflow.xyz"),
  })
  .strict()
  .transform((values) => ({
    ...values,
    dir:
      values.dir ??
      (values["env-file"] ? dirname(resolve(values["env-file"])) : "reports/analytics-staging"),
  }));

export function snapshotOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    allowNegative: true,
    options: {
      help: { type: "boolean" },
      network: { type: "string" },
      audience: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      dir: { type: "string" },
      posthog: { type: "boolean" },
      api: { type: "boolean" },
      "env-file": { type: "string" },
      "app-env": { type: "string" },
      "app-host": { type: "string" },
    },
  });
  return SnapshotOptionsSchema.parse(values);
}
