import { z } from "zod";

export const AuditLogQuerySchema = z.object({
  cursor: z.string().guid({ error: "Invalid uuid" }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
  userId: z.string().guid({ error: "Invalid uuid" }).optional(),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
