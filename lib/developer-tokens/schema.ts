import { z } from "zod";

export const MAX_ACTIVE_DEVELOPER_TOKENS = 10;
export const MAX_DEVELOPER_TOKEN_GRANTS = 100;
export const DEVELOPER_API_TOKEN_PATTERN = /^pfd_[0-9a-f]{64}$/;
export const DeveloperTokenPermissionSchema = z.enum(["READ_ONLY", "READ_OPERATE"]);
export type DeveloperTokenPermission = z.infer<typeof DeveloperTokenPermissionSchema>;
const DeploymentIdsSchema = z
  .array(
    z
      .string()
      .guid({ error: "Invalid uuid" })
      .transform((id) => id.toLowerCase()),
  )
  .max(MAX_DEVELOPER_TOKEN_GRANTS)
  .refine((ids) => new Set(ids).size === ids.length, "Deployment IDs must be unique");
export const CreateDeveloperTokenSchema = z
  .object({
    label: z.string().trim().min(1).max(64).optional(),
    permission: DeveloperTokenPermissionSchema,
    deploymentIds: DeploymentIdsSchema.refine(
      (ids) => ids.length > 0,
      "Select at least one deployment",
    ),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type CreateDeveloperToken = z.infer<typeof CreateDeveloperTokenSchema>;
export const UpdateDeveloperTokenSchema = z.object({ deploymentIds: DeploymentIdsSchema }).strict();
export type UpdateDeveloperToken = z.infer<typeof UpdateDeveloperTokenSchema>;
export const DeveloperTokenListQuerySchema = z
  .object({
    cursor: z.string().guid({ error: "Invalid uuid" }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type DeveloperTokenListQuery = z.infer<typeof DeveloperTokenListQuerySchema>;
export const DeveloperTokenSchema = z
  .object({
    id: z.string().guid({ error: "Invalid uuid" }),
    tokenPrefix: z.string(),
    label: z.string().nullable(),
    permission: DeveloperTokenPermissionSchema,
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    deploymentIds: z.array(z.string().guid({ error: "Invalid uuid" })),
  })
  .strict();
export type DeveloperToken = z.infer<typeof DeveloperTokenSchema>;
export const CreatedDeveloperTokenSchema = DeveloperTokenSchema.extend({
  token: z.string().regex(DEVELOPER_API_TOKEN_PATTERN),
});
export type CreatedDeveloperToken = z.infer<typeof CreatedDeveloperTokenSchema>;
export const DeveloperTokenListSchema = z
  .object({
    items: z.array(DeveloperTokenSchema),
    nextCursor: z.string().guid({ error: "Invalid uuid" }).nullable(),
  })
  .strict();
export type DeveloperTokenList = z.infer<typeof DeveloperTokenListSchema>;
export const DeveloperTokenDeploymentSchema = z
  .object({
    id: z.string().guid({ error: "Invalid uuid" }),
    flowName: z.string(),
    network: z.string(),
  })
  .strict();
export type DeveloperTokenDeployment = z.infer<typeof DeveloperTokenDeploymentSchema>;
export const DeveloperTokenDeploymentListSchema = z
  .object({
    items: z.array(DeveloperTokenDeploymentSchema),
    nextCursor: z.string().guid({ error: "Invalid uuid" }).nullable(),
  })
  .strict();

export type DeveloperTokenDeploymentList = z.infer<typeof DeveloperTokenDeploymentListSchema>;
