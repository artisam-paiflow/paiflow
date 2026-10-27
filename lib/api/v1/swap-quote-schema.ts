import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { stroopsSchema, bpsSchema } from "@/lib/flows/primitives";

/** Callers select a deployed node and amount; assets, router and slippage are never overrides. */
export const SwapQuoteQuerySchema = z
  .object({
    amountStroops: stroopsSchema({ message: "Must be a positive i128 integer in stroops" }),
    nodeId: z.string().min(1).max(128).optional(),
  })
  .strict();
const contract = z.string().refine(StrKey.isValidContract);
export const SwapQuoteSchema = z
  .object({
    deploymentId: z.string().guid({ error: "Invalid uuid" }),
    network: z.enum(["testnet", "mainnet"]),
    nodeId: z.string().min(1),
    contractAddress: contract,
    assetInContractAddress: contract,
    assetOutContractAddress: contract,
    routerAddress: contract,
    pairAddress: contract,
    amountInStroops: stroopsSchema({ message: "Invalid input" }),
    amountOutStroops: stroopsSchema({ message: "Invalid estimate" }),
    amountOutMinStroops: z
      .string()
      .regex(/^\d{1,39}$/)
      .refine((v) => !/^\d{1,39}$/.test(v) || BigInt(v) <= (1n << 127n) - 1n),
    slippageBps: bpsSchema(),
    readStartedAt: z.string().datetime(),
    quotedAt: z.string().datetime(),
    freshness: z.literal("live"),
    estimate: z.literal(true),
    scope: z.literal("selected_node"),
    meetsMinimumAtQuote: z.boolean(),
  })
  .strict();
export type SwapQuoteQuery = z.infer<typeof SwapQuoteQuerySchema>;
export type SwapQuote = z.infer<typeof SwapQuoteSchema>;
