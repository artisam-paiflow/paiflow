import { z } from "zod";
import {
  CreationValueSchema,
  PolicyIdSchema,
  ContractAddressSchema,
} from "@/lib/flows/field-policies";
import { FlowGraphSchema } from "@/lib/flows/schema";

// Finite leaves, never caller-selected JSON paths, topology, modes or deployment ownership.
export const CreationFieldSchema = z.enum([
  "recipient",
  "amountStroops",
  "percentageBps",
  "minAmountStroops",
  "splitRecipient",
  "splitBps",
  "splitAmountStroops",
  "amountPerIntervalStroops",
  "subscriber",
  "amountPerPeriodStroops",
  "intervalAmount",
  "intervalUnit",
  "startsAt",
  "endsAt",
  "occurrences",
  "pauseAllowed",
  "retrieveAllowed",
  "relayer",
  "threshold",
  "oracle",
  "oracleKey",
  "at",
  "signer",
  "vault",
  "slippageBps",
  "deadlineSecs",
]);
export type CreationField = z.infer<typeof CreationFieldSchema>;
export const CreationDeclarationSchema = z
  .object({
    inputId: PolicyIdSchema,
    label: z.string().min(1).max(80),
    target: z
      .object({
        nodeId: z.string().min(1).max(128),
        field: CreationFieldSchema,
        // Index into one immutable published roster; membership/order cannot be bound.
        index: z.number().int().min(0).max(19).optional(),
      })
      .strict(),
    type: z.enum([
      "wallet",
      "contract",
      "stroops",
      "bps",
      "integer",
      "timestamp",
      "boolean",
      "text",
    ]),
    defaultValue: CreationValueSchema.optional(),
    constraints: z
      .object({
        min: CreationValueSchema.optional(),
        max: CreationValueSchema.optional(),
        minLength: z.number().int().min(0).max(280).optional(),
        maxLength: z.number().int().min(0).max(280).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (const value of [input.defaultValue, input.constraints?.min, input.constraints?.max]) {
      if (value && value.type !== input.type)
        ctx.addIssue({
          code: "custom",
          message: "Default and bounds must match the declared type",
        });
    }
    if (
      (input.constraints?.min || input.constraints?.max) &&
      !["stroops", "bps", "integer", "timestamp"].includes(input.type)
    )
      ctx.addIssue({ code: "custom", message: "This type does not support ordered bounds" });
    if (
      (input.constraints?.minLength !== undefined || input.constraints?.maxLength !== undefined) &&
      input.type !== "text"
    )
      ctx.addIssue({ code: "custom", message: "Length constraints require text" });
    if ((input.constraints?.minLength ?? 0) > (input.constraints?.maxLength ?? 280))
      ctx.addIssue({ code: "custom", message: "Invalid text length range" });
  });
export type CreationDeclaration = z.infer<typeof CreationDeclarationSchema>;
export const TemplateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    graph: FlowGraphSchema,
    inputs: z.array(CreationDeclarationSchema).max(256),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const ids = definition.inputs.map((input) => input.inputId);
    const targets = definition.inputs.map((input) => JSON.stringify(input.target));
    if (new Set(ids).size !== ids.length || new Set(targets).size !== targets.length)
      ctx.addIssue({ code: "custom", message: "Duplicate input ID or target" });
  });
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;
export const CreateFlowTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(280).optional(),
    definition: TemplateDefinitionSchema,
  })
  .strict();
export type CreateFlowTemplate = z.infer<typeof CreateFlowTemplateSchema>;
export const UpdateFlowTemplateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(280).nullable().optional(),
    definition: TemplateDefinitionSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined || input.description !== undefined || input.definition !== undefined,
    "Empty update",
  );
export type UpdateFlowTemplate = z.infer<typeof UpdateFlowTemplateSchema>;
export const PublishFlowTemplateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export type PublishFlowTemplate = z.infer<typeof PublishFlowTemplateSchema>;
export const RetireFlowTemplateSchema = z.object({ confirm: z.literal("retire") }).strict();
export type RetireFlowTemplate = z.infer<typeof RetireFlowTemplateSchema>;
export const FlowTemplateListQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type FlowTemplateListQuery = z.infer<typeof FlowTemplateListQuerySchema>;
export const TemplateArtifactsSchema = z
  .object({
    version: z.literal(1),
    compilerAbi: z.literal(1),
    factoryAddress: ContractAddressSchema,
    factoryWasmHash: z.string().regex(/^[a-f0-9]{64}$/),
    nodes: z
      .array(
        z
          .object({
            nodeId: z.string().min(1),
            templateKind: z.enum([
              "SPLITTER",
              "STREAMER",
              "CONDITIONAL",
              "DEPOSIT_TRIGGER",
              "ROUTER",
              "TIMELOCK",
              "WEBHOOK",
              "SUBSCRIPTION",
              "ORACLE",
              "MULTISIG",
              "SWAPPER",
              "YIELD",
              "PAYER",
              "TIMELOCK_BRANCH",
            ]),
            wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
            abiHash: z.string().regex(/^[a-f0-9]{64}$/),
            policyVersion: z.union([z.literal(0), z.literal(1)]),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
export type TemplateArtifacts = z.infer<typeof TemplateArtifactsSchema>;
