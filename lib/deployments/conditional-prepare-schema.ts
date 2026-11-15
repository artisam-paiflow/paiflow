import { z } from "zod";
import { WalletAddressSchema } from "@/lib/flows/field-policies";

/** Saved before the first request. A keyed retry can recover an admitted
 * original even when its preparation response was lost. */
export const ConditionalDeployPrepareSchema = z
  .object({
    version: z.literal(2),
    flowId: z.uuid(),
    sourceAccount: WalletAddressSchema,
    preparationKey: z.uuid(),
  })
  .strict();
export type ConditionalDeployPrepare = z.infer<typeof ConditionalDeployPrepareSchema>;
export function conditionalDeploymentKey(preparationKey: string): string {
  return `conditional-deploy:${z.uuid().parse(preparationKey).toLowerCase()}`;
}
