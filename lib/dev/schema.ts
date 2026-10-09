import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

export const DevPayerSchema = z
  .object({
    nodeId: z.string().optional(),
    recipient: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
      .optional(),
    mode: z.enum(["fixed", "percentage"]).optional(),
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string").optional(),
    percentage: z.number().min(0).max(100).optional(),
  })
  .refine(
    (b) =>
      b.mode === "percentage"
        ? b.percentage === undefined || b.percentage > 0
        : b.amountStroops === undefined || b.amountStroops !== "0",
    {
      message:
        "Provide a positive amountStroops for fixed mode or a positive percentage for percentage mode",
    },
  );

export const DevSplitRecipientSchema = z
  .object({
    address: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
      .optional(),
    label: z.string().max(64).optional(),
    mode: z.enum(["percentage", "fixed"]),
    bps: z.number().int().min(1).max(10_000).optional(),
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string").optional(),
    payoutMode: z.enum(["crypto", "fiat"]).default("crypto"),
    bankDetail: z
      .object({
        accountName: z.string(),
        accountNumber: z.string(),
        bankCode: z.string(),
      })
      .optional(),
  })
  .refine((r) => (r.mode === "percentage" ? r.bps !== undefined : !!r.amountStroops), {
    message: "percentage recipients need bps; fixed recipients need amountStroops",
  })
  .refine((r) => !(r.payoutMode === "crypto" && !r.address), {
    message: "crypto recipients require a valid Stellar address",
  })
  .refine(
    (r) => {
      if (r.payoutMode !== "fiat") return true;
      return (
        !!r.bankDetail?.accountName && !!r.bankDetail?.accountNumber && !!r.bankDetail?.bankCode
      );
    },
    { message: "fiat recipients require bankDetail (accountName, accountNumber, bankCode)" },
  )
  .refine((r) => !(r.payoutMode === "fiat" && r.mode === "percentage"), {
    message: "fiat cash-out recipients must use fixed mode",
  });

export const DevSplitterSchema = z.object({
  nodeId: z.string().optional(),
  recipients: z.array(DevSplitRecipientSchema).min(1).max(20),
});

export type DevPayer = z.infer<typeof DevPayerSchema>;
export type DevSplitter = z.infer<typeof DevSplitterSchema>;
export type DevSplitRecipient = z.infer<typeof DevSplitRecipientSchema>;
