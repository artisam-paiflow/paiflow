import { z } from "zod";
import { AUDIENCES } from "./policy";
export const UsageReportSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    network: z.enum(["testnet", "mainnet"]),
    audience: z.enum(AUDIENCES),
  })
  .strict()
  .refine((v) => new Date(v.start) < new Date(v.end), {
    message: "Start must precede end",
    path: ["end"],
  });
export type UsageReportInput = z.infer<typeof UsageReportSchema>;
