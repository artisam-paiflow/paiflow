import { z } from "zod";
import { AnalyticsAudienceSchema } from "./schema";
export const CreateAnalyticsAccountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(12).max(256),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  analyticsAudience: AnalyticsAudienceSchema,
});
export const PatchAnalyticsAccountSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  isActive: z.boolean().optional(),
  resetPassword: z.string().min(12).max(256).optional(),
  unlock: z.boolean().optional(),
  analyticsAudience: AnalyticsAudienceSchema.optional(),
});
