import { z } from "zod";
import { isAccountId } from "@/lib/stellar/strkey";

export const PreparedRecoverySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("RESUMABLE"),
    unsignedXdr: z.string().min(10),
    txHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceAccount: z
      .string()
      .refine((value): boolean => isAccountId(value), "Invalid Stellar account"),
    network: z.enum(["testnet", "mainnet"]),
  }),
  z.object({ status: z.literal("EXPIRED") }),
  z.object({ status: z.literal("BLOCKED") }),
]);
export type PreparedRecovery = z.infer<typeof PreparedRecoverySchema>;
