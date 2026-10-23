import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

export const MAX_ALLOWANCE = (1n << 127n) - 1n;
export const AllowancePrepareSchema = z
  .object({
    amount: z
      .string()
      .max(39)
      .regex(/^[0-9]+$/)
      .refine(
        (value) =>
          value.length <= 39 &&
          /^[0-9]+$/.test(value) &&
          BigInt(value) > 0n &&
          BigInt(value) <= MAX_ALLOWANCE,
        "Amount must be positive and fit in i128",
      ),
    userAddress: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
  })
  .strict();
export const AllowanceSubmitSchema = z
  .object({
    signedXdr: z.string().min(10).max(200_000),
    intent: z.string().min(10).max(4096),
  })
  .strict();

export const AllowanceDeploymentIdSchema = z.string().guid({ error: "Invalid uuid" });

export const AllowanceStatusSchema = z.object({ intent: z.string().min(10).max(4096) }).strict();
