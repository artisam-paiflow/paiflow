import { z } from "zod";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import { WalletAddressSchema } from "@/lib/flows/field-policies";

/** Original compiled terms tied to one exact prepared deployment. It is review
 * evidence, never a substitute for server envelope/constructor verification. */
export const ConditionalDeploymentReviewSchema = z
  .object({
    version: z.literal(2),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    networkPassphrase: z.string(),
    sourceAccount: WalletAddressSchema,
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    envelope: ConditionalDeploymentEnvelopeSchema,
  })
  .strict()
  .superRefine((review, ctx) => {
    const passphrase =
      review.network === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015";
    if (
      review.networkPassphrase !== passphrase ||
      review.sourceAccount !== review.envelope.definition.owner
    )
      ctx.addIssue({
        code: "custom",
        message: "Deployment review must match its network and immutable owner",
      });
  });
export type ConditionalDeploymentReview = z.infer<typeof ConditionalDeploymentReviewSchema>;
