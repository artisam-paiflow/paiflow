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
