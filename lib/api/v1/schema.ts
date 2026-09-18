import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

// Shared by the owner-session token routes and the "API access" panel. No
// server-only import: the panel validates with the same schema before it posts.
// The execute schemas below are also the source #470's OpenAPI text is read from,
// so their `.describe()` strings are public documentation.

export const CreateApiTokenSchema = z
  .object({
    label: z.string().trim().min(1, "Label cannot be blank").max(64).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type CreateApiToken = z.infer<typeof CreateApiTokenSchema>;

/** A token as the list and revoke routes return it. Never carries the hash. */
export const ApiTokenSchema = z.object({
  id: z.string().uuid(),
  tokenPrefix: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

/** The create response: the one time the plaintext `token` leaves the server. */
export const CreatedApiTokenSchema = ApiTokenSchema.extend({ token: z.string() });
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>;

/** Stated wherever a caller can trip over them: the prepare docs and its 402/422 errors. */
export const EXECUTE_PREREQUISITES =
  "`from` must be a funded account on this network: it pays the deposit and the fee, and signs " +
  "the envelope. The flow's payout recipient must hold a trustline for the asset it receives; " +
  "a missing trustline reverts the whole pipeline.";

export const ExecutePrepareSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,39}$/, "Must be a whole number of stroops")
      // Zod still runs this after the regex fails, and BigInt("1.5") throws.
      .refine((s) => !/^\d{1,39}$/.test(s) || BigInt(s) > 0n, "Must be greater than zero")
      .describe("Amount to deposit into the swapper flow, in stroops of its input asset."),
    from: z
      .string()
      .refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address")
      .describe("G-address that deposits, pays the fee and signs the returned envelope."),
  })
  .strict()
  .describe(`Prepare the deposit that executes a swapper flow. ${EXECUTE_PREREQUISITES}`);
export type ExecutePrepare = z.infer<typeof ExecutePrepareSchema>;

export const ExecutePreparedSchema = z
  .object({
    xdr: z.string().describe("Unsigned transaction envelope, base64 XDR. Sign it and submit it."),
    networkPassphrase: z.string().describe("Network passphrase to sign with."),
    network: z.enum(["testnet", "mainnet"]),
    expiresAt: z
      .string()
      .describe("ISO time after which the network refuses the envelope; prepare again."),
  })
  .describe("An unsigned deposit that executes a swapper flow.");
export type ExecutePrepared = z.infer<typeof ExecutePreparedSchema>;

export const ExecuteSubmitSchema = z
  .object({
    signedXdr: z
      .string()
      .min(10)
      .max(200_000)
      .describe(
        "The envelope returned by prepare, signed by `from`. Anything but a single `deposit` " +
          "call on this flow's trigger contract is refused.",
      ),
  })
  .strict()
  .describe("Submit a signed deposit that executes a swapper flow.");
export type ExecuteSubmit = z.infer<typeof ExecuteSubmitSchema>;

export const ExecuteSubmitQuerySchema = z.object({
  wait: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true")
    .describe("`false` returns PENDING as soon as the network accepts the transaction."),
});

export const ExecuteStatusSchema = z.enum(["SUCCESS", "PENDING", "FAILED"]);
export type ExecuteStatus = z.infer<typeof ExecuteStatusSchema>;

export const ExecuteSubmittedSchema = z
  .object({
    txHash: z.string().describe("Hash of the submitted transaction, hex."),
    status: ExecuteStatusSchema.describe(
      "PENDING: accepted, not yet final; resubmit the same envelope to check again.",
    ),
    ledger: z.number().int().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .describe("The outcome of executing a swapper flow.");
export type ExecuteSubmitted = z.infer<typeof ExecuteSubmittedSchema>;

/** `GET /api/v1/deployments/{id}/events` query. Every value arrives as a string. */
export const ListEventsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    txHash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex transaction hash")
      .transform((v) => v.toLowerCase())
      .optional(),
  })
  .strict();
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const ContractEventItemSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string(),
  kind: z.string(),
  /** The event's first topic: `"swap"` for a swap, whose `kind` is `PAYOUT`. */
  topic: z.string().nullable(),
  ledger: z.number().int(),
  txHash: z.string(),
  occurredAt: z.string(),
  data: z.unknown().nullable(),
});
export type ContractEventItem = z.infer<typeof ContractEventItemSchema>;

/** `nextCursor` is present on the last page too, so a poller stores it and asks again later. It
 * is `null` only when the deployment has no events and the request carried no cursor. */
export const ListEventsResponseSchema = z.object({
  items: z.array(ContractEventItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ListEventsResponse = z.infer<typeof ListEventsResponseSchema>;

/** The public demo response: like `CreatedApiTokenSchema`, the one time a plaintext token
 * leaves the server — but issued to an anonymous caller, so it names its own deployment. */
export const DemoTokenSchema = z
  .object({
    deploymentId: z
      .string()
      .uuid()
      .describe("The shared demo deployment this token reaches, and the only one it reaches."),
    token: z
      .string()
      .regex(/^pfk_[0-9a-f]{64}$/)
      .describe("Bearer token for the routes above. Shown once and never retrievable again."),
    expiresAt: z.string().describe("ISO time the token stops working. Ask again for a new one."),
  })
  .describe("A short-lived token for the shared demo deployment on testnet.");
export type DemoToken = z.infer<typeof DemoTokenSchema>;
