import { z } from "zod";
import {
  ConditionalExecutionArgumentsSchema,
  ConditionalExecutionIntentSchema,
} from "@/lib/flows/conditional-v2";
import { ConditionalCurrentConfigurationSchema } from "@/lib/flows/conditional-v2-state";
import { StroopsSchema, WalletAddressSchema } from "@/lib/flows/field-policies";

const NetworkSchema = z.enum(["testnet", "mainnet"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
// Public standard-network identifiers. Keeping the values here lets the shared
// schema verify network binding without introducing a server-only crypto import.
const networkHashes = {
  testnet: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
  mainnet: "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979",
} as const;

/** Explicit API opt-in only. Missing selector retains the old v1 protocol;
 * duplicate or unknown selectors cannot be silently normalized. Other query
 * parameters keep their endpoint's existing parsing rules. */
export function conditionalExecutionVersion(parameters: URLSearchParams): 1 | 2 {
  const { version } = z
    .object({ version: z.array(z.enum(["1", "2"])).max(1) })
    .parse({ version: parameters.getAll("version") });
  return version[0] === "2" ? 2 : 1;
}

const SupportedConditionalExecutionSchema = ConditionalCurrentConfigurationSchema.safeExtend({
  supported: z.literal(true),
  deploymentId: z.uuid(),
  network: NetworkSchema,
  policyVersion: z.literal(2),
});

/** Isolated from ExecutionDiscoverySchema. Readers must verify explicit
 * deployment generation, reviewed executable hashes, getters and complete
 * instance witnesses before returning supported:true. */
export const ConditionalExecutionDiscoverySchema = z.discriminatedUnion("supported", [
  z
    .object({
      version: z.literal(2),
      supported: z.literal(false),
      deploymentId: z.uuid(),
      network: NetworkSchema,
      policyVersion: z.literal(0),
      reason: z.string().min(1),
    })
    .strict(),
  SupportedConditionalExecutionSchema,
]);
export type ConditionalExecutionDiscovery = z.infer<typeof ConditionalExecutionDiscoverySchema>;
export type SupportedConditionalExecutionState = Extract<
  ConditionalExecutionDiscovery,
  { supported: true }
>;

export const ConditionalExecutePrepareSchema = z
  .object({
    amount: StroopsSchema.describe("Positive canonical i128-bounded stroop amount."),
    from: WalletAddressSchema.describe("Payer, transaction source and fee payer."),
    arguments: ConditionalExecutionArgumentsSchema.describe(
      "Explicit version2 inputs, including an empty list when no inputs are declared. Only the prefix and selected branch may supply declared inputs.",
    ),
  })
  .strict();
export type ConditionalExecutePrepare = z.infer<typeof ConditionalExecutePrepareSchema>;

/** All original evidence is required for the explicitly selected v2 operation.
 * Envelope/hash/auth verification belongs to the existing durable lifecycle;
 * parsing a receipt never replaces those checks. */
export const ConditionalExecutePreparedSchema = z
  .object({
    intent: z.uuid(),
    txHash: HashSchema,
    walletAddress: WalletAddressSchema,
    xdr: z.string().min(10).max(200_000),
    expiresAt: z.iso.datetime(),
    network: NetworkSchema,
    networkPassphrase: z.string(),
    execution: ConditionalExecutionIntentSchema,
  })
  .strict()
  .superRefine((prepared, ctx) => {
    if (prepared.walletAddress !== prepared.execution.payer)
      ctx.addIssue({ code: "custom", message: "Receipt wallet must match its original payer" });
    if (prepared.networkPassphrase !== passphrases[prepared.network])
      ctx.addIssue({ code: "custom", message: "Receipt network and passphrase disagree" });
    if (prepared.execution.networkPassphraseHash !== networkHashes[prepared.network])
      ctx.addIssue({ code: "custom", message: "Receipt intent is bound to another network" });
  });
export type ConditionalExecutePrepared = z.infer<typeof ConditionalExecutePreparedSchema>;
