import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { stroopsSchema } from "@/lib/flows/primitives";

const WalletAddressSchema = z
  .string()
  .refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address");

export const LegacyTriggerPrepareSchema = z
  .object({
    amount: stroopsSchema({ message: "Must be a positive whole number of stroops" }),
    userAddress: WalletAddressSchema,
  })
  .strict();

export const LegacyInvokePrepareSchema = z
  .object({
    method: z.enum(["pause", "unpause", "retrieve_unvested"]),
    contractAddress: z.string().refine(StrKey.isValidContract, "Invalid contract address"),
    userAddress: WalletAddressSchema,
  })
  .strict();

export const LegacyWalletPrepareSchema = z.object({ userAddress: WalletAddressSchema }).strict();

export const LegacySubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) }).strict();

export type LegacyTriggerPrepare = z.infer<typeof LegacyTriggerPrepareSchema>;
export type LegacyInvokePrepare = z.infer<typeof LegacyInvokePrepareSchema>;
export type LegacySubmit = z.infer<typeof LegacySubmitSchema>;
