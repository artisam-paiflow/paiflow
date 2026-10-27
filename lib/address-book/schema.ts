import { z } from "zod";
import { isAccountId } from "@/lib/stellar/strkey";

export const CreateAddressContactSchema = z.object({
  label: z.string().trim().min(1, "Contact name is required").max(64, "Use at most 64 characters"),
  address: z.string().trim().refine(isAccountId, "Enter a valid Stellar wallet address"),
  /** Inline saves create new contacts; existing callers retain explicit label upserts. */
  createOnly: z.boolean().default(false),
});
export type CreateAddressContact = z.infer<typeof CreateAddressContactSchema>;
