import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
export const WalletConnectionSchema = z
  .object({
    connectionId: z.string().guid({ error: "Invalid uuid" }),
    sessionUserId: z.string().guid({ error: "Invalid uuid" }).nullable(),
    address: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
    network: z.enum(["testnet", "mainnet"]),
    walletId: z.string().trim().min(1).max(64),
    surface: z.enum(["deploy_review", "trigger", "contract_call", "payroll"]),
  })
  .strict();
export type WalletConnectionInput = z.infer<typeof WalletConnectionSchema>;
export const AnalyticsAudienceSchema = z.enum(["INTERNAL", "EXTERNAL", "UNCLASSIFIED"]);
