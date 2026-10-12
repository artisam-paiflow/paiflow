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
  "the envelope. For issued assets, the sender and payout recipients must hold trustlines for the assets they transfer; " +
  "a missing trustline reverts the whole pipeline.";

export const ExecutePrepareSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,39}$/, "Must be a whole number of stroops")
      // Zod still runs this after the regex fails, and BigInt("1.5") throws.
      .refine((s) => !/^\d{1,39}$/.test(s) || BigInt(s) > 0n, "Must be greater than zero")
      .describe(
        "Amount to deposit into the flow's deposit trigger, in stroops of the flow's input asset. A terminal chain of fixed Pay steps requires the exact total. Fixed Pay steps before a variable step require at least their total; fixed Split supports partial batch deposits and retained residuals.",
      ),
    from: z
      .string()
      .refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address")
      .describe("G-address that deposits, pays the fee and signs the returned envelope."),
  })
  .strict()
  .describe(`Prepare the deposit that executes a deposit-triggered flow. ${EXECUTE_PREREQUISITES}`);
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
  .describe("An unsigned deposit that executes a deposit-triggered flow.");
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
  .describe("Submit a signed deposit that executes a deposit-triggered flow.");
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
  .describe("The outcome of executing a deposit-triggered flow.");
export type ExecuteSubmitted = z.infer<typeof ExecuteSubmittedSchema>;

export const ReleaseBeforeSchema = z
  .object({
    nodeId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "The timelock branch to release. Required when the deployment has more than one; " +
          "otherwise it may be omitted.",
      ),
  })
  .strict()
  .describe("Release a timelock branch's before side now (work delivered), ahead of its deadline.");
export type ReleaseBefore = z.infer<typeof ReleaseBeforeSchema>;

export const ReleasedSchema = z
  .object({
    nodeId: z.string().describe("The timelock branch node that was released."),
    txHash: z.string().describe("Hash of the confirmed release transaction, hex."),
    ledger: z.number().int().optional(),
  })
  .describe("A confirmed early release of a timelock branch's before side.");
export type Released = z.infer<typeof ReleasedSchema>;

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
    expiresAt: z
      .string()
      .datetime()
      .describe("ISO time the token stops working. Ask again for a new one."),
  })
  .describe("A short-lived token for the shared demo deployment on testnet.");
export type DemoToken = z.infer<typeof DemoTokenSchema>;

export const PayoutPrepareSchema = ExecutePrepareSchema.extend({
  amount: ExecutePrepareSchema.shape.amount.refine(
    (s) => !/^\d{1,39}$/.test(s) || BigInt(s) <= (1n << 127n) - 1n,
    "Amount exceeds the contract i128 range",
  ),
  recipient: z
    .string()
    .refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar recipient account")
    .describe("Account paid by the selected Pay; checked before any relayer mutation."),
  nodeId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe("Select one PAYER_DEV when the pipeline contains several."),
})
  .strict()
  .describe("Configure one immediate dev Pay for this recipient, then prepare its deposit.");
export type PayoutPrepare = z.infer<typeof PayoutPrepareSchema>;
export const PayoutPreparedSchema = ExecutePreparedSchema.extend({ nodeId: z.string() });
export type PayoutPrepared = z.infer<typeof PayoutPreparedSchema>;
export const PayoutSubmitSchema = ExecuteSubmitSchema.describe(
  "Submit exactly the transaction prepared by payouts for this token and deployment, with envelope signatures added.",
);
export type PayoutSubmit = z.infer<typeof PayoutSubmitSchema>;
export const PayoutSubmittedSchema = ExecuteSubmittedSchema;
export type PayoutSubmitted = z.infer<typeof PayoutSubmittedSchema>;

/** Absence from RPC is uncertainty, never proof of failure. */
export const TransactionStatusSchema = z.object({
  txHash: z.string().regex(/^[0-9a-f]{64}$/),
  network: z.enum(["testnet", "mainnet"]),
  status: z.enum(["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"]),
  ledger: z.number().int().positive().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

/** Keyed webhook attempts may have no transaction hash if preparation was interrupted. */
export const WebhookAttemptResponseSchema = TransactionStatusSchema.partial({
  txHash: true,
}).extend({
  attemptId: z.string().uuid(),
});

/** Discovery describes integration support, not live execution readiness. */
export const CapabilityOperationSchema = z
  .object({
    status: z.enum(["supported", "conditional", "unsupported"]),
    authentication: z.enum(["deployment_token", "webhook_secret", "subscriber_wallet"]),
    requirements: z.array(z.string()),
    nodeIds: z.array(z.string()),
  })
  .strict();
export type CapabilityOperation = z.infer<typeof CapabilityOperationSchema>;

export const CapabilitiesAssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }).strict(),
  z.object({ kind: z.literal("known"), symbol: z.literal("USDC") }).strict(),
  z
    .object({
      kind: z.literal("custom"),
      code: z.string().regex(/^[A-Za-z0-9]{1,12}$/),
      issuer: z.string().refine(StrKey.isValidEd25519PublicKey),
    })
    .strict(),
]);

export const DeploymentCapabilitiesSchema = z
  .object({
    deploymentId: z.string().uuid(),
    network: z.enum(["testnet", "mainnet"]),
    configurationSource: z.literal("deployment_snapshot"),
    triggerType: z.enum([
      "deposit",
      "webhook",
      "subscription",
      "payroll",
      "schedule",
      "oracle",
      "unknown",
    ]),
    inputAsset: CapabilitiesAssetSchema.nullable().describe(
      "Initial asset metadata from the deployment snapshot, or null when unavailable. Not a live contract read; mutable configuration may have changed.",
    ),
    operations: z
      .object({
        execute: CapabilityOperationSchema,
        events: CapabilityOperationSchema,
        balances: CapabilityOperationSchema,
        transactions: CapabilityOperationSchema,
        releaseEarly: CapabilityOperationSchema,
        payouts: CapabilityOperationSchema,
        webhook: CapabilityOperationSchema,
        subscriptionAllowance: CapabilityOperationSchema,
        subscriptionState: CapabilityOperationSchema,
      })
      .strict(),
  })
  .strict()
  .describe(
    "Supported means the integration path exists for the recorded deployment. Conditional requires additional eligibility checks. Unsupported means no matching path can be established. No status guarantees current balances, configuration, consent, deadline or infrastructure readiness.",
  );
export type DeploymentCapabilities = z.infer<typeof DeploymentCapabilitiesSchema>;

/** Live Subscription configuration; allowance uses integer stroops, never floating point. */
export const SubscriptionStateSchema = z
  .object({
    deploymentId: z.string().uuid(),
    flowName: z.string(),
    network: z.enum(["testnet", "mainnet"]),
    templateKind: z.enum(["SUBSCRIPTION", "SUBSCRIPTION_DEV"]),
    contractAddress: z.string().refine(StrKey.isValidContract),
    tokenContractAddress: z.string().refine(StrKey.isValidContract),
    subscriber: z.string().refine(StrKey.isValidEd25519PublicKey).nullable(),
    isCancelled: z.boolean(),
    asset: CapabilitiesAssetSchema.nullable(),
    assetLabel: z.string(),
    allowance: z
      .string()
      .regex(/^\d{1,39}$/)
      .refine((v) => !/^\d{1,39}$/.test(v) || BigInt(v) <= (1n << 127n) - 1n),
    setupRequired: z.boolean(),
  })
  .strict();
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

export const DeploymentBalanceNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    templateKind: z.string().min(1),
    contractAddress: z.string().refine(StrKey.isValidContract),
    tokenContract: z.string().refine(StrKey.isValidContract).nullable(),
    balanceStroops: z
      .string()
      .regex(/^\d{1,39}$/)
      .refine((v) => !/^\d{1,39}$/.test(v) || BigInt(v) <= (1n << 127n) - 1n)
      .nullable(),
    readAt: z.string().datetime().nullable(),
    stale: z.boolean(),
    error: z.string().optional(),
  })
  .strict();
export const DeploymentBalancesSchema = z
  .object({
    deploymentId: z.string().uuid(),
    network: z.enum(["testnet", "mainnet"]),
    totals: z.array(
      z
        .object({
          tokenContract: z.string().refine(StrKey.isValidContract),
          balanceStroops: z.string().regex(/^\d+$/),
        })
        .strict(),
    ),
    nodes: z.array(DeploymentBalanceNodeSchema),
    freshness: z
      .object({
        status: z.enum(["fresh", "partial", "stale"]),
        totalsComplete: z.boolean(),
        attemptedAt: z.string().datetime(),
        cached: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type DeploymentBalances = z.infer<typeof DeploymentBalancesSchema>;
