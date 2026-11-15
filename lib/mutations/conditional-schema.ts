import { z } from "zod";
import {
  ConditionalMutationArgumentsSchema,
  ConditionalMutationIntentSchema,
} from "@/lib/flows/conditional-v2";
import { ConditionalNodeStateSchema } from "@/lib/flows/conditional-v2-state";
import { ConditionalExecutionDiscoverySchema } from "@/lib/api/v1/conditional-execution-schema";
import {
  ConfigurationRevisionSchema,
  PolicyIdSchema,
  StroopsSchema,
  WalletAddressSchema,
} from "@/lib/flows/field-policies";
import { ConfigurationHistorySchema, MutationPreparationRefusalSchema } from "./schema";

const NetworkSchema = z.enum(["testnet", "mainnet"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
const networkHashes = {
  testnet: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
  mainnet: "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979",
} as const;

export const ConditionalMutationPrepareSchema = z
  .object({
    admin: WalletAddressSchema,
    arguments: ConditionalMutationArgumentsSchema,
  })
  .strict();
export type ConditionalMutationPrepare = z.infer<typeof ConditionalMutationPrepareSchema>;

export const ConditionalMutationStateSchema = ConditionalExecutionDiscoverySchema.options[1]
  .safeExtend({
    admin: WalletAddressSchema,
    mutationSupported: z.literal(true),
  })
  .superRefine((state, ctx) => {
    if (state.admin !== state.definition.owner)
      ctx.addIssue({
        code: "custom",
        message: "Mutation admin must be the immutable deployment owner",
      });
  });
export type ConditionalMutationState = z.infer<typeof ConditionalMutationStateSchema>;

export const ConditionalMutationPreparedSchema = z
  .object({
    intent: z.uuid(),
    txHash: HashSchema,
    walletAddress: WalletAddressSchema,
    xdr: z.string().min(10).max(200_000),
    expiresAt: z.iso.datetime(),
    network: NetworkSchema,
    networkPassphrase: z.string(),
    feeStroops: StroopsSchema,
    mutation: ConditionalMutationIntentSchema,
  })
  .strict()
  .superRefine((prepared, ctx) => {
    if (prepared.walletAddress !== prepared.mutation.admin)
      ctx.addIssue({ code: "custom", message: "Receipt wallet must match its original admin" });
    if (
      prepared.networkPassphrase !== passphrases[prepared.network] ||
      prepared.mutation.networkPassphraseHash !== networkHashes[prepared.network]
    )
      ctx.addIssue({
        code: "custom",
        message: "Receipt network, passphrase and mutation binding disagree",
      });
  });
export type ConditionalMutationPrepared = z.infer<typeof ConditionalMutationPreparedSchema>;

export const ConditionalPreparationRefusalSchema = MutationPreparationRefusalSchema.extend({
  version: z.literal(2),
});
export type ConditionalPreparationRefusal = z.infer<typeof ConditionalPreparationRefusalSchema>;

export const ConditionalConfigurationHistorySchema = z
  .object({
    version: z.literal(2),
    deploymentId: z.uuid(),
    network: NetworkSchema,
    coverage: z.literal("observed-revisions-only"),
    historyComplete: z.literal(false),
    revisionCoverage: z
      .array(
        z
          .object({
            nodeId: PolicyIdSchema,
            highestObservedRevision: ConfigurationRevisionSchema,
            observedRevisionCount: z.string().regex(/^[1-9]\d*$/),
            missingRevisionCount: z.string().regex(/^(0|[1-9]\d*)$/),
          })
          .strict(),
      )
      .max(40),
    items: z
      .array(
        ConfigurationHistorySchema.shape.items.element.extend({
          configuration: ConditionalNodeStateSchema,
        }),
      )
      .max(100),
    nextCursor: z.uuid().nullable(),
  })
  .strict()
  .superRefine((history, ctx) => {
    const coverage = new Map(history.revisionCoverage.map((row) => [row.nodeId, row]));
    if (
      coverage.size !== history.revisionCoverage.length ||
      new Set(history.items.map((item) => item.id)).size !== history.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "History coverage and items must have unique identities",
      });
    for (const row of history.revisionCoverage) {
      const possible = BigInt(row.highestObservedRevision) + 1n;
      const count = BigInt(row.observedRevisionCount);
      if (count > possible || BigInt(row.missingRevisionCount) !== possible - count)
        ctx.addIssue({
          code: "custom",
          message: "History revision coverage must preserve exact missing counts",
        });
    }
    for (const item of history.items) {
      const row = coverage.get(item.configuration.nodeId);
      if (!row || BigInt(item.configuration.revision) > BigInt(row.highestObservedRevision))
        ctx.addIssue({
          code: "custom",
          message: "History items must belong to their observed revision coverage",
        });
    }
  });
export type ConditionalConfigurationHistory = z.infer<typeof ConditionalConfigurationHistorySchema>;
