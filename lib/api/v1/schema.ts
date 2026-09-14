import { z } from "zod";

// Shared by the owner-session token routes and the "API access" panel. No
// server-only import: the panel validates with the same schema before it posts.

export const CreateApiTokenSchema = z
  .object({
    label: z.string().trim().min(1, "Label cannot be blank").max(64).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type CreateApiToken = z.infer<typeof CreateApiTokenSchema>;

/** A token as the list and revoke routes return it. Never carries the hash. */
export const ApiTokenSchema = z.object({
  id: z.string().uuid(),
  tokenPrefix: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

/** The create response: the one time the plaintext `token` leaves the server. */
export const CreatedApiTokenSchema = ApiTokenSchema.extend({ token: z.string() });
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>;

/** `GET /api/v1/deployments/{id}/events` query. Every value arrives as a string. */
export const ListEventsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    txHash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex transaction hash")
      .transform((v) => v.toLowerCase())
      .optional(),
  })
  .strict();
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const ContractEventItemSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string(),
  kind: z.string(),
  /** The event's first topic: `"swap"` for a swap, whose `kind` is `PAYOUT`. */
  topic: z.string().nullable(),
  ledger: z.number().int(),
  txHash: z.string(),
  occurredAt: z.string(),
  data: z.unknown().nullable(),
});
export type ContractEventItem = z.infer<typeof ContractEventItemSchema>;

/** `nextCursor` is present on the last page too, so a poller stores it and asks again later. It
 * is `null` only when the deployment has no events and the request carried no cursor. */
export const ListEventsResponseSchema = z.object({
  items: z.array(ContractEventItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ListEventsResponse = z.infer<typeof ListEventsResponseSchema>;
