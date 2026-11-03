import { z } from "zod";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { CreationBindingsSchema } from "@/lib/flows/field-policies";
import { TemplateArtifactsSchema, TemplateDefinitionSchema } from "./schema";
import { InstanceStateSchema } from "@/lib/flow-instances/schema";
import { InstancePreparedTermsSchema } from "@/lib/flow-instances/compiled-review-schema";

export const TemplateSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  draftRevision: z.number().int().positive(),
  retiredAt: z.string().nullable(),
});
export const TemplateDraftSchema = TemplateSummarySchema.extend({
  draft: TemplateDefinitionSchema,
});
export const TemplatePageSchema = z.object({
  items: z.array(TemplateSummarySchema),
  nextCursor: z.uuid().nullable(),
});
export const VersionSummarySchema = z.object({
  id: z.uuid(),
  templateId: z.uuid(),
  version: z.number().int().positive(),
  network: z.enum(["testnet", "mainnet"]),
  contentHash: z.string(),
  retiredAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export const VersionSchema = VersionSummarySchema.extend({
  definition: TemplateDefinitionSchema,
  artifacts: TemplateArtifactsSchema,
});
export const VersionPageSchema = z.object({
  items: z.array(VersionSummarySchema),
  nextCursor: z.uuid().nullable(),
});
export const BindingPreviewSchema = z.object({
  graph: FlowGraphSchema,
  bindings: CreationBindingsSchema,
  artifacts: TemplateArtifactsSchema,
});
export type TemplateDraft = z.infer<typeof TemplateDraftSchema>;
export type TemplateVersion = z.infer<typeof VersionSchema>;
export const InstanceInitialReviewSchema = BindingPreviewSchema.extend({
  receipt: InstanceStateSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  compiledTerms: InstancePreparedTermsSchema,
}).superRefine((review, ctx) => {
  if (review.bindings.templateVersionId !== review.receipt.templateVersionId)
    ctx.addIssue({ code: "custom", message: "Initial review names a different immutable version" });
});
