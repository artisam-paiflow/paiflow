import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
export const FundingActionSchema = z.enum(["schedule.fund", "webhook.fund"]);
export const FundingPrepareSchema = z
  .object({
    nodeId: z.string().min(1).max(128).optional(),
    fromAddress: z.string().refine(StrKey.isValidEd25519PublicKey),
    tokenContractAddress: z.string().refine(StrKey.isValidContract),
    amountStroops: z
      .string()
      .regex(/^[1-9]\d{0,38}$/)
      .refine((v) => !/^[1-9]\d{0,38}$/.test(v) || BigInt(v) <= (1n << 127n) - 1n),
  })
  .strict();
export const FundingSubmitSchema = z
  .object({
    action: FundingActionSchema,
    intent: z.string().uuid(),
    signedXdr: z.string().min(1).max(100_000),
  })
  .strict();
export const FundingReconcileSchema = FundingSubmitSchema.omit({ signedXdr: true });

export const FundingDiscoverySchema = z
  .object({
    deploymentId: z.string().uuid(),
    network: z.enum(["testnet", "mainnet"]),
    nodes: z
      .array(
        z
          .object({
            nodeId: z.string().min(1),
            templateKind: z.enum(["STREAMER", "WEBHOOK"]),
            contractAddress: z.string().refine(StrKey.isValidContract),
            action: FundingActionSchema,
            tokenContractAddress: z.string().refine(StrKey.isValidContract),
            authorization: z.literal("funding_wallet"),
            effect: z.string(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export const FundingPreparedSchema = FundingPrepareSchema.extend({
  nodeId: z.string().min(1),
  intent: z.string().uuid(),
  txHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  xdr: z.string().min(1),
  action: FundingActionSchema,
  network: z.enum(["testnet", "mainnet"]),
  networkPassphrase: z.string().min(1),
});
export const FundingReconciledSchema = FundingReconcileSchema.extend({
  txHash: z.string().regex(/^[a-f0-9]{64}$/),
  network: z.enum(["testnet", "mainnet"]),
  state: z.enum(["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"]),
  expiresAt: z.string().datetime(),
});
