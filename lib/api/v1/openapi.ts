import { SwapQuoteSchema } from "./swap-quote-schema";
import {
  DeploymentCapabilitiesSchema,
  SubscriptionStateSchema,
  TransactionStatusSchema,
  WebhookAttemptResponseSchema,
  DemoTokenSchema,
  EXECUTE_PREREQUISITES,
  ExecutePrepareSchema,
  ExecutePreparedSchema,
  ExecuteSubmitQuerySchema,
  ExecuteSubmitSchema,
  ExecuteSubmittedSchema,
  ReleaseBeforeSchema,
  ReleasedSchema,
} from "./schema";
import { V1_PRE_AUTH_LIMITS, V1_RATE_LIMITS, V1_WAIT_SLOTS } from "./limits";

// The OpenAPI 3.1 document for `/api/v1`, hand-written because no generator is installed (no new
// dependency, CLAUDE.md §10). No server-only import: `scripts/print-openapi.ts` prints it to
// `docs/api/openapi.json`. `tests/unit/api/v1/openapi.test.ts` is the drift guard: it checks the
// committed copy, that every v1 route has a path here, that every example parses with its Zod
// schema, and that the error table matches `APP_ERROR_STATUS` in `lib/errors.ts` (which is
// server-only, so it is restated here rather than imported).

export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  INSUFFICIENT_FUNDS: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_RPC: 502,
} as const;

type ErrorCode = keyof typeof ERROR_STATUS;

const rate = (r: { limit: number; windowSeconds: number }, per: string) =>
  `Rate limit: ${r.limit} requests per ${r.windowSeconds} seconds ${per}.`;

// ---- examples (illustrative; each parses with its Zod schema, checked in the drift test) ----

export const EXAMPLE_DEPLOYMENT_ID = "6b1f0c52-3d4e-4a8b-9c7d-2e5f8a1b3c4d";
const EXAMPLE_FROM = "GDMFZ5QQMDSOTPEQ6YCAWPFAB626Q6C3KLRLYMO3VWMWHQHL4L2DSIHY";
const EXAMPLE_TX_HASH = "94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d";
const XLM_SAC_TESTNET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC_SAC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const capabilityExample = (
  status: string,
  authentication = "deployment_token",
  requirements: string[] = [],
  nodeIds: string[] = [],
) => ({ status, authentication, requirements, nodeIds });

export const examples = {
  fundingDiscovery: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      network: "testnet",
      nodes: [
        {
          nodeId: "schedule",
          templateKind: "STREAMER",
          contractAddress: USDC_SAC_TESTNET,
          action: "schedule.fund",
          tokenContractAddress: XLM_SAC_TESTNET,
          authorization: "funding_wallet",
          effect: "Adds funds only; does not execute a payout or Webhook callback",
        },
      ],
    },
  },
  fundingPrepare: {
    nodeId: "schedule",
    fromAddress: EXAMPLE_FROM,
    tokenContractAddress: XLM_SAC_TESTNET,
    amountStroops: "10000000",
  },
  fundingPrepared: {
    data: {
      intent: EXAMPLE_DEPLOYMENT_ID,
      txHash: EXAMPLE_TX_HASH,
      expiresAt: "2026-10-12T00:03:00.000Z",
      xdr: "BASE64_UNSIGNED_XDR_FROM_PREPARATION",
      action: "schedule.fund",
      nodeId: "schedule",
      fromAddress: EXAMPLE_FROM,
      tokenContractAddress: XLM_SAC_TESTNET,
      amountStroops: "10000000",
      network: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  },
  fundingSubmit: {
    action: "schedule.fund",
    intent: EXAMPLE_DEPLOYMENT_ID,
    signedXdr: "BASE64_SIGNED_EXACT_PREPARATION",
  },
  fundingReconcile: { action: "schedule.fund", intent: EXAMPLE_DEPLOYMENT_ID },
  fundingReconciled: {
    data: {
      intent: EXAMPLE_DEPLOYMENT_ID,
      action: "schedule.fund",
      txHash: EXAMPLE_TX_HASH,
      network: "testnet",
      state: "PREPARED",
      expiresAt: "2026-10-12T00:03:00.000Z",
    },
  },

  balances: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      network: "testnet",
      totals: [{ tokenContract: XLM_SAC_TESTNET, balanceStroops: "10000000" }],
      nodes: [
        {
          nodeId: "schedule",
          templateKind: "STREAMER",
          contractAddress: USDC_SAC_TESTNET,
          tokenContract: XLM_SAC_TESTNET,
          balanceStroops: "10000000",
          readAt: "2026-10-12T00:00:00.000Z",
          stale: false,
        },
      ],
      freshness: {
        status: "fresh",
        totalsComplete: true,
        attemptedAt: "2026-10-12T00:00:00.000Z",
        cached: false,
      },
    },
  },
  subscriptionControlRequest: { walletAddress: EXAMPLE_FROM },
  subscriptionControlReconcileRequest: { intent: EXAMPLE_DEPLOYMENT_ID },
  subscriptionControlPrepared: {
    data: {
      intent: EXAMPLE_DEPLOYMENT_ID,
      txHash: EXAMPLE_TX_HASH,
      expiresAt: "2026-10-12T12:03:00.000Z",
      xdr: "SIMULATED_UNSIGNED_XDR",
      network: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      action: "subscription.cancel",
      walletAddress: EXAMPLE_FROM,
      nodeId: "sub",
      contractAddress: USDC_SAC_TESTNET,
      tokenContractAddress: XLM_SAC_TESTNET,
    },
  },
  subscriptionControlReconciled: {
    data: {
      intent: EXAMPLE_DEPLOYMENT_ID,
      txHash: EXAMPLE_TX_HASH,
      action: "subscription.cancel",
      state: "PREPARED",
      ledger: null,
      replacementAllowed: false,
    },
  },
  swapQuote: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      network: "testnet",
      nodeId: "swap",
      contractAddress: USDC_SAC_TESTNET,
      assetInContractAddress: XLM_SAC_TESTNET,
      assetOutContractAddress: USDC_SAC_TESTNET,
      routerAddress: USDC_SAC_TESTNET,
      pairAddress: USDC_SAC_TESTNET,
      amountInStroops: "10000000",
      amountOutStroops: "1050000",
      amountOutMinStroops: "1040000",
      slippageBps: 100,
      readStartedAt: "2026-10-12T09:00:00.000Z",
      quotedAt: "2026-10-12T09:00:01.000Z",
      freshness: "live",
      estimate: true,
      scope: "selected_node",
      meetsMinimumAtQuote: true,
    },
  },
  scheduleState: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      network: "testnet",
      nodeId: "schedule",
      contractAddress: USDC_SAC_TESTNET,
      controller: EXAMPLE_FROM,
      controlEligibility: {
        walletProtocolSupported: true,
        pause: false,
        resume: true,
        retrieve: true,
      },
      tokenContractAddress: XLM_SAC_TESTNET,
      paused: true,
      pauseAllowed: true,
      retrieveAllowed: true,
      balanceStroops: "20000000",
      availableStroops: "10000000",
      claimedStroops: "0",
      unvestedStroops: "10000000",
      retrievableStroops: "10000000",
      retrievalRecipient: EXAMPLE_FROM,
      readAt: "2026-10-12T00:00:00.000Z",
    },
  },
  subscriptionState: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      flowName: "Club membership",
      network: "testnet",
      templateKind: "SUBSCRIPTION",
      contractAddress: USDC_SAC_TESTNET,
      tokenContractAddress: XLM_SAC_TESTNET,
      subscriber: EXAMPLE_FROM,
      isCancelled: false,
      asset: { kind: "native" },
      assetLabel: "XLM",
      allowance: "1000000000",
      setupRequired: false,
    },
  },
  capabilities: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      network: "testnet",
      configurationSource: "deployment_snapshot",
      triggerType: "deposit",
      inputAsset: { kind: "native" },
      operations: {
        execute: capabilityExample("supported", "deployment_token", [
          "The paying wallet signs the prepared deposit; simulation checks current configuration.",
        ]),
        funding: capabilityExample("unsupported", "deployment_token", [
          "No supported funding nodes.",
        ]),
        balances: capabilityExample(
          "conditional",
          "deployment_token",
          ["Live contract assets and balances must be readable; cached for up to 10 seconds."],
          ["pay"],
        ),
        events: capabilityExample("supported", "deployment_token", [
          "Recorded events can lag the chain.",
        ]),
        transactions: capabilityExample("supported", "deployment_token", [
          "Only attributable transactions can be read; missing evidence does not prove failure.",
        ]),
        releaseEarly: capabilityExample("unsupported", "deployment_token", [
          "No deployed timelock branch supports early release.",
        ]),
        payouts: capabilityExample("unsupported", "deployment_token", [
          "Standard flows use configured recipients; per-payment recipients require an eligible Dev flow.",
        ]),
        webhook: capabilityExample("unsupported", "webhook_secret", [
          "Requires a deployed webhook trigger with HTTP callbacks enabled.",
        ]),
        swapQuote: capabilityExample("unsupported", "deployment_token", [
          "Requires a deployed Swap node.",
        ]),
        scheduleState: capabilityExample("unsupported"),
        scheduleControls: capabilityExample("unsupported"),
        subscriptionState: capabilityExample("unsupported", "deployment_token", [
          "Requires a subscription deployment.",
        ]),
        subscriptionCancel: capabilityExample("unsupported", "subscriber_wallet", [
          "Requires a supported subscription and current subscriber wallet consent.",
        ]),
        subscriptionReactivate: capabilityExample("unsupported", "subscriber_wallet", [
          "Requires a supported cancelled subscription and current subscriber wallet consent.",
        ]),
        subscriptionAllowance: capabilityExample("unsupported", "subscriber_wallet", [
          "Requires a subscription deployment.",
        ]),
      },
    },
  },
  webhookPending: {
    data: {
      attemptId: "c112ab0a-ec40-4b0f-8d1d-65d13edfe40c",
      txHash: EXAMPLE_TX_HASH,
      network: "testnet",
      status: "PENDING",
    },
  },
  transactionStatus: {
    data: { txHash: EXAMPLE_TX_HASH, network: "testnet", status: "SUCCESS", ledger: 1842917 },
  },
  payoutRequest: {
    amount: "1000000000",
    from: EXAMPLE_FROM,
    recipient: EXAMPLE_FROM,
    nodeId: "pay",
  },
  executeRequest: { amount: "1000000000", from: EXAMPLE_FROM },
  executeResponse: {
    data: {
      xdr: "AAAAAgAAAADYXPYQYOTpvJD2BAs8oB9ej3hbUuLzjbut2WPA6+L0OQAB6IQADc4pAAAAAQAAAAEAAAAAAAAAAAAAAABmxy2kAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB…(truncated)",
      networkPassphrase: "Test SDF Network ; September 2015",
      network: "testnet",
      expiresAt: "2026-09-15T09:03:00.000Z",
    },
  },
  releaseRequest: { nodeId: "timelock-branch-1" },
  releaseResponse: {
    data: { nodeId: "timelock-branch-1", txHash: EXAMPLE_TX_HASH, ledger: 1842917 },
  },
  releaseError422: {
    error: {
      code: "VALIDATION",
      message:
        "The deadline has passed; this condition now releases to its after side automatically.",
    },
  },
  submitRequest: {
    signedXdr:
      "AAAAAgAAAADYXPYQYOTpvJD2BAs8oB9ej3hbUuLzjbut2WPA6+L0OQAB6IQADc4pAAAAAQAAAAEAAAAAAAAAAAAAAABmxy2kAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB…(truncated)",
  },
  demoTokenResponse: {
    data: {
      deploymentId: EXAMPLE_DEPLOYMENT_ID,
      token: "pfk_4f1c9d2a7b8e3056c14fa9d7be205183cc47e6f90a2b5d38e71c406fa9b8d2e5",
      expiresAt: "2026-09-18T15:04:05.000Z",
    },
  },
  submitSuccess: { data: { txHash: EXAMPLE_TX_HASH, status: "SUCCESS", ledger: 1842917 } },
  submitPending: { data: { txHash: EXAMPLE_TX_HASH, status: "PENDING" } },
  submitFailed: {
    data: {
      txHash: EXAMPLE_TX_HASH,
      status: "FAILED",
      ledger: 1842917,
      error: {
        code: "txTooLate",
        message:
          "The transaction's 180-second window expired before it reached the network. Prepare it again.",
      },
    },
  },
  eventsResponse: {
    data: {
      items: [
        {
          id: "0c9d7a3e-5b1f-4e2a-8d6c-7f4b3a2e1d0c",
          eventId: "0007915171594088448-0000000001",
          kind: "RECEIVE",
          topic: "deposit",
          ledger: 1842917,
          txHash: EXAMPLE_TX_HASH,
          occurredAt: "2026-09-15T09:00:12.000Z",
          data: { from: EXAMPLE_FROM, amount: "1000000000" },
        },
        {
          id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          eventId: "0007915171594088448-0000000004",
          kind: "PAYOUT",
          topic: "swap",
          ledger: 1842917,
          txHash: EXAMPLE_TX_HASH,
          occurredAt: "2026-09-15T09:00:12.000Z",
          data: {
            assetIn: XLM_SAC_TESTNET,
            assetOut: USDC_SAC_TESTNET,
            amountIn: "1000000000",
            amountOut: "105594796",
          },
        },
      ],
      nextCursor: "MTg0MjkxN3wwMDA3OTE1MTcxNTk0MDg4NDQ4LTAwMDAwMDAwMDQ",
      hasMore: false,
    },
  },
  createTokenRequest: { label: "partner backend", expiresInDays: 90 },
  createTokenResponse: {
    data: {
      id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
      tokenPrefix: "pfk_3f9a1c7e",
      label: "partner backend",
      createdAt: "2026-09-15T08:55:00.000Z",
      lastUsedAt: null,
      expiresAt: "2026-12-14T08:55:00.000Z",
      revokedAt: null,
      token: "pfk_3f9a1c7e…(truncated)",
    },
  },
  tokenListResponse: {
    data: [
      {
        id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
        tokenPrefix: "pfk_3f9a1c7e",
        label: "partner backend",
        createdAt: "2026-09-15T08:55:00.000Z",
        lastUsedAt: "2026-09-15T09:00:10.000Z",
        expiresAt: "2026-12-14T08:55:00.000Z",
        revokedAt: null,
      },
    ],
  },
  error401: {
    error: {
      code: "UNAUTHENTICATED",
      message: "A valid API token for this deployment is required",
    },
  },
  sessionError401: {
    error: { code: "UNAUTHENTICATED", message: "Authentication required" },
  },
  error422: {
    error: {
      code: "VALIDATION",
      message: "Invalid input",
      fields: { amount: ["Must be a whole number of stroops"] },
    },
  },
  // What `assertDepositEnvelope` throws: a message and no `fields`.
  submitError422: {
    error: {
      code: "VALIDATION",
      message: "The envelope does not invoke this flow's trigger contract",
    },
  },
  eventsError422: {
    error: {
      code: "VALIDATION",
      message: "Invalid cursor",
      fields: { cursor: ["Invalid cursor"] },
    },
  },
} as const;

// ---- building blocks ----

const json = (schema: object, example?: unknown) => ({
  "application/json": { schema, ...(example === undefined ? {} : { example }) },
});

const dataEnvelope = (ref: string) => ({
  type: "object",
  required: ["data"],
  properties: { data: { $ref: ref } },
});

const errorResponse = (description: string, example?: unknown) => ({
  description,
  content: json({ $ref: "#/components/schemas/Error" }, example),
});

const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  UNAUTHENTICATED:
    "Missing, unknown, revoked or expired token, or a token for another deployment. One message for every case.",
  INSUFFICIENT_FUNDS: "The `from` account does not exist on this network.",
  FORBIDDEN: "Not allowed for this caller.",
  NOT_FOUND: "Malformed deployment id, or a deployment that is not (or no longer) confirmed.",
  CONFLICT: "The request conflicts with current state.",
  VALIDATION:
    "The body or query failed validation (`fields` names each problem), or the network refused the request as built.",
  RATE_LIMITED:
    "Too many requests in the window: the per-token limit, or, for a token not issued or used in " +
    "the last 30 days, the per-address limit on looking such tokens up (see the rate limits above).",
  INTERNAL: "Unexpected server error.",
  UPSTREAM_RPC: "The Soroban RPC request failed or the network was busy; retry.",
};

// The token-management routes are guarded by `requireTokenManager` (a signed-in session), not
// `requireDeploymentToken`, so their errors mean different things than the token API's.
const SESSION_ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  ...ERROR_DESCRIPTIONS,
  UNAUTHENTICATED: "No valid signed-in session.",
  FORBIDDEN: "A sandbox session.",
  NOT_FOUND:
    "Malformed id, or a deployment you do not own (its existence is not disclosed). On revoke, also a token that is not on this deployment.",
  CONFLICT: "The deployment already has 10 active tokens.",
  VALIDATION:
    "The body failed validation (`fields` names each problem), or the deployment is not `CONFIRMED`.",
};

// The demo route is public: its refusals are about the instance's configuration, not the caller's
// credentials, so the shared descriptions would mislead.
const DEMO_ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  ...ERROR_DESCRIPTIONS,
  FORBIDDEN: "The public demo is not enabled on this instance.",
  RATE_LIMITED: "Too many demo tokens from this address, or the instance is at its hourly cap.",
  INTERNAL:
    "The demo deployment is not configured, confirmed or deposit-triggered. One message for every case; the operator is alerted.",
};

const errorsWith =
  (descriptions: Record<ErrorCode, string>, codeExamples: Partial<Record<ErrorCode, unknown>>) =>
  (...codes: ErrorCode[]) =>
    Object.fromEntries(
      codes.map((code) => [
        String(ERROR_STATUS[code]),
        errorResponse(`\`${code}\`: ${descriptions[code]}`, codeExamples[code]),
      ]),
    );

const errorsFor = (overrides: Partial<Record<ErrorCode, unknown>> = {}) =>
  errorsWith(ERROR_DESCRIPTIONS, {
    UNAUTHENTICATED: examples.error401,
    VALIDATION: examples.error422,
    ...overrides,
  });
const errors = errorsFor();

const sessionErrors = errorsWith(SESSION_ERROR_DESCRIPTIONS, {
  UNAUTHENTICATED: examples.sessionError401,
});

const demoErrors = errorsWith(DEMO_ERROR_DESCRIPTIONS, {});

const deploymentIdParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Deployment id (UUID). A malformed id is a 404.",
  schema: { type: "string", format: "uuid" },
  example: EXAMPLE_DEPLOYMENT_ID,
};

const preparationRequestIdParam = {
  name: "x-preparation-request-id",
  in: "header",
  required: false,
  description:
    "The preparation response's x-history-request-id. Send it with this prepared envelope and reuse it on retries; a new preparation gets a new ID. Optional analytics correlation only: it does not authorize or deduplicate a payment. Reports verify the account, token, deployment, operation and context before linking requests.",
  schema: { type: "string", format: "uuid" },
};

const preparationResponseHeaders = {
  "x-history-request-id": {
    description:
      "Server-generated request UUID. Keep it with the prepared envelope and send it as x-preparation-request-id on submit/retry. Missing linkage does not prove abandonment.",
    schema: { type: "string", format: "uuid" },
  },
};

const errorTable = (Object.keys(ERROR_STATUS) as ErrorCode[])
  .map((code) => `| \`${code}\` | ${ERROR_STATUS[code]} |`)
  .join("\n");

const TOKEN_ROUTES_RATE = rate(
  V1_RATE_LIMITS.apiTokens,
  "per signed-in user, shared across the token routes",
);

const executeShape = ExecutePrepareSchema.shape;
const preparedShape = ExecutePreparedSchema.shape;
const submittedShape = ExecuteSubmittedSchema.shape;
const demoShape = DemoTokenSchema.shape;
const releasedShape = ReleasedSchema.shape;
const releaseShape = ReleaseBeforeSchema.shape;

function schedulePaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const failures = errors(
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION",
    "CONFLICT",
    "RATE_LIMITED",
    "UPSTREAM_RPC",
  );
  const security = [{ bearerAuth: [] }];
  paths["/api/v1/deployments/{id}/schedule/state"] = {
    get: {
      tags: ["Capabilities"],
      operationId: "getScheduleState",
      summary: "Read live Schedule state and control eligibility",
      description:
        "Uncached reads of snapshot-selected STREAMER controller/asset instance fields, state and permission getters, and token holding balance. availableStroops is vested unpaid payout entitlement, not token balance or a guarantee of sufficient funding; claimedStroops is cumulative claimed entitlement. unvestedStroops is max(balance minus available, zero); retrievableStroops is that difference only while paused and retrieval-permitted. Retrieval returns funds to the contract-configured controller. Reads occur across RPC calls, not an atomic ledger snapshot; amounts are indicative and simulation/execution are authoritative. Contract-address controllers can be read but cannot use this account-wallet signing protocol. Errors never masquerade as zero balances. Active service required; hosted testnet verification remains pending. " +
        rate(V1_RATE_LIMITS.scheduleState, "per token"),
      security,
      parameters: [
        deploymentIdParam,
        {
          name: "nodeId",
          in: "query",
          required: false,
          schema: { type: "string", minLength: 1, maxLength: 128 },
          description: "Required to disambiguate multiple Schedule nodes",
        },
      ],
      responses: {
        "200": {
          description: "Current Schedule state",
          content: json(dataEnvelope("#/components/schemas/ScheduleState"), examples.scheduleState),
        },
        ...failures,
      },
    },
  };
  for (const action of ["pause", "resume", "retrieve"] as const) {
    const base = `/api/v1/deployments/{id}/schedule/${action}`;
    const body = (properties: object, required: string[]) => ({
      required: true,
      content: json({ type: "object", additionalProperties: false, required, properties }),
    });
    const response = (ref: string) => ({
      "200": { description: "Action result", content: json(dataEnvelope(ref)) },
      ...failures,
    });
    paths[base] = {
      post: {
        tags: ["Capabilities"],
        operationId: `prepareSchedule${action}`,
        summary: `Prepare wallet-authorized Schedule ${action}`,
        description:
          "The deployment token grants API access, not wallet consent. Select deployed nodeId when ambiguous. Requires current controller account wallet and live state/permissions. Pause only unpaused permitted schedules; resume only paused pause-permitted schedules; retrieve only paused retrieval-permitted schedules with holding balance greater than vested unpaid entitlement. Simulation uses the server network and 180-second envelope; return unsignedXdr, intent, txHash and expiresAt. For retrieval, recipient is the deployed controller and estimatedAmountStroops is indicative; no caller recipient/amount is accepted. Sign unchanged in the wallet; no keys belong in request bodies. One unresolved intent per node across controls/funding; conflicts include the existing intent/hash for reconciliation. Hosted testnet verification remains pending. " +
          rate(V1_RATE_LIMITS.schedulePrepare, "per token"),
        security,
        parameters: [deploymentIdParam],
        requestBody: body(
          {
            walletAddress: { type: "string", description: "Current controller account G-address" },
            nodeId: { type: "string", minLength: 1, maxLength: 128 },
          },
          ["walletAddress"],
        ),
        responses: response("#/components/schemas/SchedulePrepared"),
      },
    };
    paths[`${base}/submit`] = {
      post: {
        tags: ["Capabilities"],
        operationId: `submitSchedule${action}`,
        summary: `Submit unchanged wallet-signed Schedule ${action}`,
        description:
          "Strict exact intent/action/deployment/network/node/hash and valid controller wallet signature. Recheck live controller/permissions before the first send. Durable admission records the hash before sending; repeated/concurrent/uncertain submissions look up the same outcome without rebroadcasting. Poll /transactions/{txHash}; UNKNOWN, queue REJECTED or a timeout does not authorize replacement. First-send expiry requires reconciliation, never a new envelope by time alone. " +
          rate(V1_RATE_LIMITS.scheduleSubmit, "per token"),
        security,
        parameters: [deploymentIdParam],
        requestBody: body(
          {
            intent: { type: "string", format: "uuid" },
            signedXdr: { type: "string", minLength: 1, maxLength: 100000 },
          },
          ["intent", "signedXdr"],
        ),
        responses: response("#/components/schemas/TransactionStatus"),
      },
    };
    paths[`${base}/reconcile`] = {
      post: {
        tags: ["Capabilities"],
        operationId: `reconcileSchedule${action}`,
        summary: `Reconcile an existing Schedule ${action} intent`,
        description:
          "Reconcile the matching action intent, including abandoned unsigned preparation. SUCCESS/FAILED require durable ledger finality; EXPIRED requires a closed ledger after maxTime plus covered historical NOT_FOUND proof. Missing/lagging history and RPC errors retain reservations. replacementAllowed=true only for durable SUCCESS/FAILED/proven EXPIRED, and new preparation still checks live eligibility. Active deployment service required; retired token access is not reopened. " +
          rate(V1_RATE_LIMITS.scheduleReconcile, "per token"),
        security,
        parameters: [deploymentIdParam],
        requestBody: body({ intent: { type: "string", format: "uuid" } }, ["intent"]),
        responses: response("#/components/schemas/ScheduleReconciled"),
      },
    };
  }
  return paths;
}

// Owner-session management is intentionally separate from bearer API v1.
const developerTokenIdParam = {
  name: "tokenId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const developerTokenPagination = [
  { name: "cursor", in: "query", schema: { type: "string", format: "uuid" } },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
];
const developerManagementErrors = () =>
  sessionErrors(
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "VALIDATION",
    "RATE_LIMITED",
    "INTERNAL",
  );
const developerMetadataProperties = {
  id: { type: "string", format: "uuid" },
  tokenPrefix: { type: "string" },
  label: { type: ["string", "null"] },
  permission: { type: "string", enum: ["READ_ONLY", "READ_OPERATE"] },
  createdAt: { type: "string", format: "date-time" },
  ...Object.fromEntries(
    ["lastUsedAt", "expiresAt", "revokedAt"].map((name) => [
      name,
      { type: ["string", "null"], format: "date-time" },
    ]),
  ),
  deploymentIds: {
    type: "array",
    maxItems: 100,
    uniqueItems: true,
    items: { type: "string", format: "uuid" },
  },
};
const developerManagementDescription =
  "Owner browser session only; bearer credentials cannot manage tokens. Sandbox sessions refused. Successful responses are no-store. Writes share 30 requests/minute per owner. Removing grants or revoking prevents subsequent authorization, never cancels submitted transactions or deletes financial history.";
function developerManagementOperation(
  operationId: string,
  summary: string,
  schema: string,
  options: {
    item?: boolean;
    request?: string;
    create?: boolean;
    description?: string;
  } = {},
) {
  return {
    tags: ["Token management (owner session)"],
    operationId,
    summary,
    description: developerManagementDescription + " " + (options.description ?? ""),
    security: [{ cookieAuth: [] }],
    parameters: options.item
      ? [developerTokenIdParam]
      : options.create
        ? []
        : developerTokenPagination,
    ...(options.request
      ? {
          requestBody: {
            required: true,
            content: json({ $ref: "#/components/schemas/" + options.request }),
          },
        }
      : {}),
    responses: {
      [options.create ? "201" : "200"]: {
        description: options.create
          ? "Created; token is revealed only in this response. Store securely now."
          : "Safe metadata; never plaintext or hash.",
        headers: { "Cache-Control": { schema: { type: "string", const: "no-store" } } },
        content: json(dataEnvelope("#/components/schemas/" + schema)),
      },
      ...developerManagementErrors(),
    },
  };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Paiflow API v1",
    version: "1.1.0",
    description: [
      "Execute a deployed deposit-triggered flow (Pay, Split, condition, swap) and poll its on-chain events from your own backend.",
      "",
      "Every `/api/v1/deployments/{id}/…` call requires a Bearer credential: a deployment token (`pfk_…`) bound to one deployment, or a developer token (`pfd_…`) with explicit grants to selected existing deployments still owned by the token owner. GET /api/v1/deployments discovers only that credential's eligible deployments. Developer READ_ONLY permits reads, quotes and funding discovery; READ_OPERATE additionally permits preparation, submission, reconciliation and relayer release. See docs/api/developer-token-permissions.md for the complete matrix. No token grants flow/deployment creation or legacy dev/payroll access.",
      "",
      "**Execute deposits are signed by the caller.** `execute` returns an unsigned envelope; you sign it with the " +
        "`from` key, which stays on your side, and post it to `execute/submit`. A leaked token can " +
        "prepare and relay a deposit you signed. Webhook and early-release operations use the relayer.",
      "",
      'Successful responses are `{ "data": … }`. Errors are `{ "error": { code, message, fields?, details? } }`:',
      "",
      "| Code | HTTP status |",
      "| --- | --- |",
      errorTable,
      "",
      "Rate limits are per token and per endpoint (each operation lists its own). Allowances are shared across the selected deployments. A token that " +
        "has been issued or has worked in the last 30 days is subject to nothing else. Any other " +
        "token is limited per client address before it is looked up: " +
        `${V1_PRE_AUTH_LIMITS.ipBackstop.limit} lookups per ` +
        `${V1_PRE_AUTH_LIMITS.ipBackstop.windowSeconds} seconds, and, after ` +
        `${V1_PRE_AUTH_LIMITS.failedAuth.limit} failed authentications in ` +
        `${V1_PRE_AUTH_LIMITS.failedAuth.windowSeconds} seconds from the address, ` +
        `${V1_PRE_AUTH_LIMITS.blockedLookups.limit} per ` +
        `${V1_PRE_AUTH_LIMITS.blockedLookups.windowSeconds} seconds. A token refused in the last ` +
        "minute is refused again without a lookup. Refusal of a live developer credential for a missing grant is never negatively cached, so selection edits take effect immediately. So one caller's bad token does not lock out " +
        "others on the same network.",
      "",
      "No account? `POST /api/v1/demo-token` hands you a short-lived token for a shared demo " +
        "flow, so every call above can be tried straight away.",
      "",
      "The public instance runs on Stellar **testnet**. Guide: `docs/api/README.md`.",
    ].join("\n"),
  },
  servers: [{ url: "https://beta.app.paiflow.xyz", description: "Beta app (Stellar testnet)" }],
  tags: [
    {
      name: "Capabilities",
      description: "Discover deployment integration paths and their prerequisites.",
    },
    {
      name: "Webhooks",
      description:
        "Authenticated callbacks releasing a pre-funded flow, optionally deduplicated by application-event key.",
    },
    {
      name: "Execute",
      description: "Run a deposit-triggered flow: prepare, sign on your side, submit.",
    },
    {
      name: "Release",
      description:
        "Signal that work was delivered: release a timelock branch's before side ahead of its deadline.",
    },
    {
      name: "Subscriptions",
      description:
        "Current-subscriber wallet cancellation and reactivation with explicit finality recovery.",
    },
    { name: "Events", description: "Cursor-based polling of a deployment's decoded events." },
    { name: "Spec", description: "This document." },
    {
      name: "Demo",
      description:
        "Get a token for the shared testnet demo flow with no account, so the API above can be " +
        "tried before you register.",
    },
    {
      name: "Token management (owner session)",
      description:
        "How deployment and developer tokens are minted and revoked. These are the owner's signed-in session " +
        "routes behind the API access panel, not part of the token-authenticated API: they take " +
        "the session cookie, never a deployment token, and a sandbox session is refused.",
    },
  ],
  paths: {
    "/api/developer-tokens": {
      get: developerManagementOperation(
        "listDeveloperTokens",
        "List owner developer credentials",
        "DeveloperTokenList",
      ),
      post: developerManagementOperation(
        "createDeveloperToken",
        "Create selected-deployment credential",
        "CreatedDeveloperToken",
        {
          create: true,
          request: "CreateDeveloperTokenRequest",
          description:
            "At most 10 unrevoked unexpired credentials per owner. Select 1–100 unique existing CONFIRMED ACTIVE owned deployment UUIDs; future deployments never inherit access. Label, permission and expiry are immutable. Omit expiresInDays for no expiry.",
        },
      ),
    },
    "/api/developer-tokens/deployments": {
      get: developerManagementOperation(
        "listDeveloperTokenCandidates",
        "List eligible owned deployment choices",
        "DeveloperTokenDeploymentList",
      ),
    },
    "/api/developer-tokens/{tokenId}": {
      get: developerManagementOperation(
        "inspectDeveloperToken",
        "Inspect credential metadata",
        "DeveloperToken",
        { item: true },
      ),
      patch: developerManagementOperation(
        "updateDeveloperToken",
        "Atomically replace selected deployments",
        "DeveloperToken",
        {
          item: true,
          request: "UpdateDeveloperTokenRequest",
          description:
            "Only deploymentIds can change. Empty selection suspends all access. Revoked or expired credentials cannot be edited. Replacement selection must contain only eligible owned deployments; remove retiring/retired grants.",
        },
      ),
      delete: developerManagementOperation(
        "revokeDeveloperToken",
        "Revoke credential retaining history",
        "DeveloperToken",
        {
          item: true,
          description: "Idempotent; an already revoked credential returns unchanged.",
        },
      ),
    },
    "/api/v1/deployments": {
      get: {
        tags: ["Capabilities"],
        operationId: "listAuthorizedDeployments",
        summary: "List deployments authorized by this token",
        description:
          "UUID cursor is an immutable ID bound, not a required existing row. Default page size 20, maximum 100. Bearer pfd_ or pfk_ only. Returns currently confirmed active deployments explicitly granted to this credential and still owned by its active non-sandbox owner. A deployment token returns at most its own deployment. Safe metadata only; no session fallback. Read-only tokens are accepted. 60 requests per token per minute shared across deployments.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string", format: "uuid" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          "200": {
            description: "Authorized deployments",
            content: json({
              type: "object",
              required: ["data"],
              properties: {
                data: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "flowName", "network"],
                        properties: {
                          id: { type: "string", format: "uuid" },
                          flowName: { type: "string" },
                          network: { type: "string" },
                        },
                      },
                    },
                    nextCursor: { type: "string", format: "uuid", nullable: true },
                  },
                },
              },
            }),
          },
          ...errors("UNAUTHENTICATED", "VALIDATION", "RATE_LIMITED", "INTERNAL"),
        },
      },
    },
    "/api/v1/deployments/{id}/funding": {
      get: {
        tags: ["Capabilities"],
        operationId: "discoverFunding",
        summary: "Discover live funding assets",
        description:
          "Deployment bearer token required; no session. Active, confirmed deployment on the environment network. Any consenting funding wallet may fund; no owner/admin requirement. Funding adds funds only, never executes a Schedule payout or Webhook callback. Public /trigger, /submit-trigger and hosted /trigger/{deploymentId} alternatives remain available. One unresolved preparation per node blocks other actions; reconcile the original before replacement. UNKNOWN, timeout, REJECTED or missing history alone never permits another deposit. Hosted testnet evidence remains pending." +
          rate(V1_RATE_LIMITS.funding, "per token"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        responses: {
          "200": {
            description: "Discover live funding assets",
            content: json(
              dataEnvelope("#/components/schemas/FundingDiscovery"),
              examples.fundingDiscovery,
            ),
          },
          ...errors(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "FORBIDDEN",
            "VALIDATION",
            "CONFLICT",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
          ),
        },
      },
      post: {
        tags: ["Capabilities"],
        operationId: "prepareFunding",
        summary: "Prepare wallet-authorized funding",
        description:
          "Deployment bearer token required; no session. Active, confirmed deployment on the environment network. Any consenting funding wallet may fund; no owner/admin requirement. Funding adds funds only, never executes a Schedule payout or Webhook callback. Public /trigger, /submit-trigger and hosted /trigger/{deploymentId} alternatives remain available. One unresolved preparation per node blocks other actions; reconcile the original before replacement. UNKNOWN, timeout, REJECTED or missing history alone never permits another deposit. Hosted testnet evidence remains pending." +
          rate(V1_RATE_LIMITS.funding, "per token"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: true,
          content: json({ $ref: "#/components/schemas/FundingPrepare" }, examples.fundingPrepare),
        },
        responses: {
          "200": {
            description: "Prepare wallet-authorized funding",
            content: json(
              dataEnvelope("#/components/schemas/FundingPrepared"),
              examples.fundingPrepared,
            ),
          },
          ...errors(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "FORBIDDEN",
            "VALIDATION",
            "CONFLICT",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/funding/submit": {
      post: {
        tags: ["Capabilities"],
        operationId: "submitFunding",
        summary: "Submit the exact signed funding envelope",
        description:
          "Deployment bearer token required; no session. Active, confirmed deployment on the environment network. Any consenting funding wallet may fund; no owner/admin requirement. Funding adds funds only, never executes a Schedule payout or Webhook callback. Public /trigger, /submit-trigger and hosted /trigger/{deploymentId} alternatives remain available. One unresolved preparation per node blocks other actions; reconcile the original before replacement. UNKNOWN, timeout, REJECTED or missing history alone never permits another deposit. Hosted testnet evidence remains pending." +
          rate(V1_RATE_LIMITS.fundingSubmit, "per token"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: true,
          content: json({ $ref: "#/components/schemas/FundingSubmit" }, examples.fundingSubmit),
        },
        responses: {
          "200": {
            description: "Submit the exact signed funding envelope",
            content: json(dataEnvelope("#/components/schemas/TransactionStatus")),
          },
          ...errors(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "FORBIDDEN",
            "VALIDATION",
            "CONFLICT",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/funding/reconcile": {
      post: {
        tags: ["Capabilities"],
        operationId: "reconcileFunding",
        summary: "Reconcile funding finality and ledger-proven expiry",
        description:
          "Deployment bearer token required; no session. Active, confirmed deployment on the environment network. Any consenting funding wallet may fund; no owner/admin requirement. Funding adds funds only, never executes a Schedule payout or Webhook callback. Public /trigger, /submit-trigger and hosted /trigger/{deploymentId} alternatives remain available. One unresolved preparation per node blocks other actions; reconcile the original before replacement. UNKNOWN, timeout, REJECTED or missing history alone never permits another deposit. Hosted testnet evidence remains pending." +
          rate(V1_RATE_LIMITS.fundingSubmit, "per token"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: true,
          content: json(
            { $ref: "#/components/schemas/FundingReconcile" },
            examples.fundingReconcile,
          ),
        },
        responses: {
          "200": {
            description: "Reconcile funding finality and ledger-proven expiry",
            content: json(
              dataEnvelope("#/components/schemas/FundingReconciled"),
              examples.fundingReconciled,
            ),
          },
          ...errors(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "FORBIDDEN",
            "VALIDATION",
            "CONFLICT",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
          ),
        },
      },
    },
    ...schedulePaths(),
    ...Object.fromEntries(
      (["cancel", "reactivate"] as const).flatMap((action) =>
        (["prepare", "submit", "reconcile"] as const).map((step) => {
          const request =
            step === "prepare"
              ? "SubscriptionControlPrepare"
              : step === "submit"
                ? "WalletControlSubmit"
                : "SubscriptionControlReconcile";
          const response =
            step === "prepare"
              ? "SubscriptionControlPrepared"
              : step === "submit"
                ? "TransactionStatus"
                : "SubscriptionControlReconciled";
          return [
            `/api/v1/deployments/{id}/subscription/${action}/${step}`,
            {
              post: {
                tags: ["Subscriptions"],
                operationId: `${step}Subscription${action === "cancel" ? "Cancel" : "Reactivate"}`,
                summary: `${step} wallet-authorized subscription ${action}`,
                description: [
                  "Requires the deployment bearer token and ACTIVE service. Ordinary subscriptions are eligible. Existing Dev cancellation continues when Dev mode is disabled; Dev reactivation requires the feature enabled. Payroll and malformed or ambiguous snapshots are refused.",
                  "Preparation reads the deployed current subscriber, asset and cancellation state. Only that configured wallet can cancel an active subscription or reactivate a cancelled subscription. The builder simulates on the server network with finite transaction bounds. Cancellation revokes allowance; reactivation grants no allowance, creates no subscriber and never immediately charges or changes billing.",
                  "Sign exactly the returned xdr in the subscriber wallet on networkPassphrase; submit intent and signedXdr. Changed envelopes, wrong signers and fee-bumps are refused. Submission rechecks live eligibility on the first send and durably admits the exact hash before broadcasting. Retrying an already claimed intent returns status, even when successful cancellation changed state.",
                  "UNKNOWN, REJECTED, timeouts and expired clocks never authorize replacement. Poll the deployment transaction endpoint and explicitly POST the action's reconcile endpoint with intent. Recovery adopts externally submitted ledger results and proves expiry only with complete RPC history. PREPARED or SUBMITTING retains the reservation; SUCCESS, FAILED or proven EXPIRED sets replacementAllowed:true, subject to current eligibility for a new preparation. RPC/history gaps retain reservations. No generic or token-only wallet consent.",
                  "Hosted testnet rehearsal remains required before advertising event availability; these paths describe the implemented API surface.",
                  rate(
                    V1_RATE_LIMITS[
                      step === "prepare"
                        ? "subscriptionControlPrepare"
                        : step === "submit"
                          ? "subscriptionControlSubmit"
                          : "subscriptionControlReconcile"
                    ],
                    "per token",
                  ),
                ].join("\n\n"),
                security: [{ bearerAuth: [] }],
                parameters: [deploymentIdParam],
                requestBody: {
                  required: true,
                  content: json(
                    { $ref: `#/components/schemas/${request}` },
                    step === "prepare"
                      ? examples.subscriptionControlRequest
                      : step === "reconcile"
                        ? examples.subscriptionControlReconcileRequest
                        : undefined,
                  ),
                },
                responses: {
                  "200": {
                    description:
                      "Wallet control preparation, submission status or explicit recovery result.",
                    content: json(
                      dataEnvelope(`#/components/schemas/${response}`),
                      step === "prepare"
                        ? {
                            data: {
                              ...examples.subscriptionControlPrepared.data,
                              action: `subscription.${action}`,
                            },
                          }
                        : step === "reconcile"
                          ? {
                              data: {
                                ...examples.subscriptionControlReconciled.data,
                                action: `subscription.${action}`,
                              },
                            }
                          : examples.transactionStatus,
                    ),
                  },
                  ...errors(
                    "UNAUTHENTICATED",
                    "FORBIDDEN",
                    "NOT_FOUND",
                    "CONFLICT",
                    "VALIDATION",
                    "RATE_LIMITED",
                    "UPSTREAM_RPC",
                    "INTERNAL",
                    "INSUFFICIENT_FUNDS",
                  ),
                },
              },
            },
          ];
        }),
      ),
    ),
    "/api/v1/deployments/{id}/balances": {
      get: {
        tags: ["Capabilities"],
        operationId: "getDeploymentBalances",
        summary: "Read deployment contract balances with freshness",
        description:
          "Deployment-scoped display reads of current token contracts from supported on-chain instance storage. Schedule, Webhook, time/oracle conditions, Pay, Split and Swap balances are supported candidates; mutable Pay/Split require Dev mode enabled. Swap reports both input and output tokens. No owner account balances or private configuration. Multisig and unsupported kinds are excluded and, when present beside supported nodes, reported as errors making totals incomplete. Token contract addresses are asset identity; graph asset labels are not authoritative. Balances are not Schedule payout availability or evidence of payment success. The 10-second process-local single-flight cache preserves original readAt/attemptedAt; a Redis per-deployment refresh lease spans replicas (another replica without cached data answers 429), configured unavailable Redis fails closed for refreshes, and no Redis means process-local coordination; poll no faster than every 10 seconds. Each refresh admits at most four workers and 64 contracts, stops scheduling at 25 seconds, with existing finite HTTP timeouts. Errors use null balances and stale:true; partial totals sum only successful reads, never stand for complete balances. Fresh means all supported/holding targets read successfully within the display window, not a ledger-consistent atomic snapshot. Hosted testnet verification remains pending before participant support is claimed. " +
          rate(V1_RATE_LIMITS.balances, "per token"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        responses: {
          "200": {
            description: "Display balances and partial/completeness information",
            content: json(
              dataEnvelope("#/components/schemas/DeploymentBalances"),
              examples.balances,
            ),
          },
          ...errors(
            "UNAUTHENTICATED",
            "FORBIDDEN",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/swap-quote": {
      get: {
        tags: ["Capabilities"],
        operationId: "getDeploymentSwapQuote",
        summary: "Estimate output of one deployed Swap node",
        description: [
          "Requires this deployment's bearer token, confirmed deployment on the environment network and active service. Select a standard SWAPPER from pipelineSnapshot; nodeId is required if several exist. Only amountStroops and nodeId are accepted; arbitrary assets, router, slippage and routes are rejected. Live asset_in/asset_out/router/slippage_bps getters determine quote configuration; the router must match the environment's configured router.",
          "Returns exact integer stroop strings, current slippage, live readStartedAt/quotedAt and estimate:true with scope:selected_node. Reads are a sequence of simulations, not an atomic ledger snapshot; live means read during this request, not cached reserves or guaranteed freshness at execution. amountOutMinStroops is the spot-less-slippage estimate at quote time, not a guaranteed payout or the final minimum for a later transaction. meetsMinimumAtQuote only compares estimated output to that estimate; false means the quote currently falls below that bound, true does not establish full-flow readiness. No full-flow prediction or new execution path; final preparation, simulation and execution remain authoritative. Cache-Control:no-store.",
          "Fixed RPC work: four configuration getters and at most five pool/router reads. Deployment-wide 20/min quote budget across tokens, with functioning shared Redis required in production. RPC/provider failures return errors, never a zero quote. Hosted testnet quote-versus-execution verification remains pending; this source API must be deployed and verified before claiming hosted support.",
          rate(V1_RATE_LIMITS.swapQuote, "per token"),
        ].join("\n\n"),
        security: [{ bearerAuth: [] }],
        parameters: [
          deploymentIdParam,
          {
            name: "amountStroops",
            in: "query",
            required: true,
            schema: { type: "string", pattern: "^[0-9]{1,39}$" },
            description:
              "Positive i128 input for the selected node, not a whole-flow deposit amount. Contract arithmetic range is checked.",
          },
          {
            name: "nodeId",
            in: "query",
            required: false,
            schema: { type: "string", minLength: 1, maxLength: 128 },
            description: "Deployed Swap node ID; required if several candidates exist.",
          },
        ],
        responses: {
          "200": {
            description: "Live selected-node estimate.",
            content: json(dataEnvelope("#/components/schemas/SwapQuote"), examples.swapQuote),
          },
          ...errors(
            "UNAUTHENTICATED",
            "FORBIDDEN",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
            "INSUFFICIENT_FUNDS",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/subscription/state": {
      get: {
        tags: ["Capabilities"],
        operationId: "getSubscriptionState",
        summary: "Read live Subscription state and allowance",
        description: [
          "Requires this deployment's bearer token, a confirmed ordinary or Dev Subscription on the environment network and active deployment service. Payroll and malformed snapshots are refused. Reads the deployed contract's current subscriber, token and cancellation state, then that subscriber's token allowance. An unconfigured Dev subscription returns subscriber:null, setupRequired:true and allowance:\"0\" without querying allowance. RPC failures return errors rather than a zero allowance or active state.",
          "tokenContractAddress is authoritative; asset is initial metadata only when it matches that token, otherwise null. Allowance is an integer stroop string. Reading does not authorize approval, charge, cancellation or reactivation. No-store response.",
          rate(V1_RATE_LIMITS.subscriptionState, "per token"),
        ].join("\n\n"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        responses: {
          "200": {
            description: "Current deployed Subscription configuration and allowance.",
            content: json(
              dataEnvelope("#/components/schemas/SubscriptionState"),
              examples.subscriptionState,
            ),
          },
          ...errors(
            "UNAUTHENTICATED",
            "FORBIDDEN",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
            "INSUFFICIENT_FUNDS",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/capabilities": {
      get: {
        tags: ["Capabilities"],
        operationId: "getDeploymentCapabilities",
        summary: "Discover a deployment's supported integration paths",
        description: [
          DeploymentCapabilitiesSchema.description,
          "Requires an authorized pfk_ or pfd_ bearer token and a confirmed deployment on the environment's network. Reads only recorded deployment metadata: no RPC, simulation, transaction submission or mutation. inputAsset is initial snapshot metadata and may be stale after Dev mutations; null means unavailable. The recorded pipeline determines contract kinds, not the current editable flow.",
          "Operations also include balances (/balances), a conditional live read of supported deployed contract funds. Operations are swapQuote (/api/v1/deployments/{id}/swap-quote), execute (execute and execute/submit), events, transactions, releaseEarly (release-early), webhook (/api/webhooks/{id}), scheduleState (/api/v1/deployments/{id}/schedule/state), scheduleControls (Schedule pause, resume and retrieve preparation, submit and reconcile), subscriptionState (/api/v1/deployments/{id}/subscription/state), subscriptionCancel and subscriptionReactivate (subscription/cancel or subscription/reactivate prepare, submit and reconcile), and subscriptionAllowance (/api/deployments/{id}/subscription-allowance and its submit/status paths, or /allowance/{id}). The payouts capability key remains in discovery responses but reports unsupported while Dev mode is disabled; no payout route is published. Each operation includes status, authentication, requirements and candidate nodeIds. Subscription approval must be checked by its own preparation/state endpoints; discovery does not establish live eligibility. nodeIds are candidates, not a guarantee that a chosen amount or path succeeds. A webhook_secret or subscriber_wallet operation is not authorized by the discovery token.",
          "Returns an explicit projection without webhook secrets, API credentials, recipients, subscriber addresses, bank details, KYC, notification settings or private graph configuration. Responses are no-store.",
          rate(V1_RATE_LIMITS.capabilities, "per token"),
        ].join("\n\n"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        responses: {
          "200": {
            description: "Deployment integration support and prerequisites, not live readiness.",
            content: json(
              dataEnvelope("#/components/schemas/DeploymentCapabilities"),
              examples.capabilities,
            ),
          },
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "RATE_LIMITED"),
        },
      },
    },
    "/api/webhooks/{id}": {
      post: {
        tags: ["Webhooks"],
        operationId: "executeWebhook",
        summary: "Release a webhook flow, with optional durable event idempotency",
        description:
          "Authenticate with x-webhook-secret, not pfk_. Deposit funding separately. For pre-funded release use escrow:true and a stroop amount; omitted amount or zero releases the whole available pool. Idempotency-Key is optional: matching requests return the original attempt without another send; different effective arguments return 409. Keys are deployment-scoped, never automatically expire, and store only key/request digests. One hash is persisted before sending; keyed sends never rebuild/resubmit automatically. Interrupted preparation without a hash remains UNKNOWN and requires operator review. Unknown/missing RPC evidence never authorizes another payment. Use the same key to poll and a pfk_ token for the transaction lookup endpoint. Unkeyed requests retain legacy behavior and can each release another payout. Fixed recipients with Dev mode off. Rate limit: 20/minute per deployment/client IP; keyed replays additionally share transaction lookup RPC limits.",
        security: [{ webhookSecret: [] }],
        parameters: [
          deploymentIdParam,
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          },
        ],
        requestBody: {
          required: true,
          content: json(
            {
              type: "object",
              properties: {
                escrow: { type: "boolean", default: false },
                amount: { type: "string", pattern: "^[0-9]+$" },
                from: {
                  type: "string",
                  description:
                    "Required for native non-escrow execution; requires signed Soroban authorization.",
                },
                auth: {
                  type: "array",
                  items: { type: "string" },
                  description: "Signed Soroban auth entries for non-escrow execution.",
                },
              },
            },
            { escrow: true, amount: "100000000" },
          ),
        },
        responses: {
          "200": {
            description: "Legacy result, or keyed terminal/submission-rejected attempt.",
            content: json({
              oneOf: [
                dataEnvelope("#/components/schemas/WebhookAttemptResponse"),
                {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      required: ["txHash"],
                      additionalProperties: false,
                      properties: {
                        txHash: { type: "string" },
                        status: { type: "string", enum: ["PENDING"] },
                      },
                    },
                  },
                },
              ],
            }),
          },
          "202": {
            description:
              "Original keyed attempt is PENDING or UNKNOWN; retry the same key. No new transaction is submitted on replay.",
            headers: {
              "Retry-After": {
                schema: { type: "string" },
                description: "Suggested seconds before polling the same key.",
              },
            },
            content: json(
              dataEnvelope("#/components/schemas/WebhookAttemptResponse"),
              examples.webhookPending,
            ),
          },
          ...errorsFor()(
            "FORBIDDEN",
            "NOT_FOUND",
            "VALIDATION",
            "CONFLICT",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
            "INTERNAL",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/execute": {
      post: {
        tags: ["Execute"],
        operationId: "prepareExecute",
        summary: "Prepare the unsigned deposit that executes a deposit-triggered flow",
        description: [
          ExecutePrepareSchema.description,
          "",
          "The flow runs through its deposit trigger; the next pipeline steps (pay, split, condition, swap) run as part of the same transaction. " +
            "Sign the returned `xdr` with the `from` key using `networkPassphrase`, before " +
            "`expiresAt`, and post it to `execute/submit`. Only flows that start with a deposit trigger can be executed; subscription, webhook, payroll and other trigger-headed flows are refused with `VALIDATION`. Configure every Pay and Split recipient before deployment.",
          "",
          rate(V1_RATE_LIMITS.execute, "per token"),
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: true,
          content: json(
            { $ref: "#/components/schemas/ExecutePrepareRequest" },
            examples.executeRequest,
          ),
        },
        responses: {
          "200": {
            description: "The unsigned envelope.",
            headers: preparationResponseHeaders,
            content: json(
              dataEnvelope("#/components/schemas/ExecutePrepared"),
              examples.executeResponse,
            ),
          },
          ...errors(
            "INSUFFICIENT_FUNDS",
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/execute/submit": {
      post: {
        tags: ["Execute"],
        operationId: "submitExecute",
        summary: "Submit the signed deposit and wait for the result",
        description: [
          ExecuteSubmitSchema.description,
          "",
          "The envelope must be the one `execute` returned, signed by `from`: anything but a single " +
            "`deposit` call on this flow's trigger contract is refused with `VALIDATION`, as is a " +
            "fee-bump envelope.",
          "",
          "Idempotent on the envelope hash: submitting the same `signedXdr` again never sends a " +
            "second transaction, it reports the one already on the network. That is also how to " +
            "check a `PENDING` result. A transaction that reached the network and failed is a " +
            "`200` with `status: FAILED` and an `error`, not an HTTP error.",
          "",
          rate(V1_RATE_LIMITS.executeSubmit, "per token"),
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        parameters: [
          deploymentIdParam,
          preparationRequestIdParam,
          {
            name: "wait",
            in: "query",
            required: false,
            description:
              `${ExecuteSubmitQuerySchema.shape.wait.description} Default \`true\`: wait up to about 25 seconds for a final status, then return \`PENDING\` if there is none yet. ` +
              `At most ${V1_WAIT_SLOTS.perToken} calls per token wait at once; a call over that still sends the transaction and returns \`PENDING\` straight away, as \`wait=false\` does. Resubmit the same \`signedXdr\` to check it.`,
            schema: { type: "string", enum: ["true", "false"], default: "true" },
          },
        ],
        requestBody: {
          required: true,
          content: json(
            { $ref: "#/components/schemas/ExecuteSubmitRequest" },
            examples.submitRequest,
          ),
        },
        responses: {
          "200": {
            description: "The outcome: `SUCCESS`, `PENDING` or `FAILED`.",
            content: {
              "application/json": {
                schema: dataEnvelope("#/components/schemas/ExecuteSubmitted"),
                examples: {
                  success: { summary: "Confirmed", value: examples.submitSuccess },
                  pending: { summary: "Accepted, not final yet", value: examples.submitPending },
                  failed: {
                    summary: "Reached the network and failed",
                    value: examples.submitFailed,
                  },
                },
              },
            },
          },
          ...errorsFor({ VALIDATION: examples.submitError422 })(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/release-early": {
      post: {
        tags: ["Release"],
        operationId: "releaseEarly",
        summary: "Release a timelock branch's before side now",
        description: [
          ReleaseBeforeSchema.description,
          "",
          "For a flow like 'pay on delivery, refund the client after the deadline': call this when " +
            "the work is delivered and the relayer pays the before side. Nothing is signed on " +
            "your side; the token is the authorisation. Unlike `execute`, this sends a " +
            "transaction and returns once it is final.",
          "",
          "After the deadline the contract refuses the before side and this returns `VALIDATION` " +
            "(422): the condition then releases to its after side automatically. It also returns " +
            "`VALIDATION` when the condition holds no funds, or when the deployment has several " +
            "timelock branches and `nodeId` is missing or unknown. The body may be omitted when " +
            "there is exactly one branch.",
          "",
          rate(V1_RATE_LIMITS.releaseBefore, "per token"),
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: false,
          content: json(
            { $ref: "#/components/schemas/ReleaseBeforeRequest" },
            examples.releaseRequest,
          ),
        },
        responses: {
          "200": {
            description: "The confirmed release.",
            content: json(dataEnvelope("#/components/schemas/Released"), examples.releaseResponse),
          },
          ...errorsFor({ VALIDATION: examples.releaseError422 })(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/transactions/{txHash}": {
      get: {
        tags: ["Execute"],
        operationId: "getTransactionStatus",
        summary: "Look up an attributed transaction without resubmitting",
        description:
          "Accepts an authorized pfk_ or pfd_ token. SUCCESS and FAILED are final; REJECTED means submission refusal, not on-chain failure. PENDING requires known acceptance. UNKNOWN means an attributed attempt has no established acceptance or finality; it never authorizes a new payment. Unattributed hashes return 404, including missing outside submissions. Supports execute records, queued webhook audit records, early-release audit records, ingested events and verified direct pipeline invocations in recent RPC envelopes. Outside indirect calls and token transfers alone are unsupported. Stored terminal outcomes and ingested events survive RPC retention; missing historical evidence cannot be reconstructed. Poll after 2 seconds, exponentially back off with jitter to 30 seconds; honor Retry-After on 429. RPC failures return 502, never FAILED. One bounded RPC read per request, at most 60/min per deployment across tokens; production requires shared Redis for that RPC budget. " +
          rate(V1_RATE_LIMITS.transactions, "per token across transaction hashes"),
        security: [{ bearerAuth: [] }],
        parameters: [
          deploymentIdParam,
          {
            name: "txHash",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
          },
        ],
        responses: {
          "200": {
            description: "Attributed transaction lifecycle.",
            content: json(
              dataEnvelope("#/components/schemas/TransactionStatus"),
              examples.transactionStatus,
            ),
          },
          ...errorsFor()(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
            "UPSTREAM_RPC",
          ),
        },
      },
    },
    "/api/v1/deployments/{id}/events": {
      get: {
        tags: ["Events"],
        operationId: "listEvents",
        summary: "Poll the deployment's events, oldest first",
        description: [
          "Forward-paginated events the app decoded for this deployment's contracts, ascending by " +
            "`(ledger, eventId)`. This is the app's record, not a raw chain feed: each event " +
            "appears once (`eventId` is unique).",
          "",
          "**Freshness.** When this deployment's events were last collected from the network more " +
            "than 10 seconds ago, a call collects them first and waits up to 5 seconds for that " +
            "before answering from the record. So an event usually appears within 10 to 20 " +
            "seconds of its ledger closing, whoever submitted the transaction (a wallet paying the " +
            "contract directly, a scanned SEP-7 QR, a scheduled charge), provided you keep " +
            "polling. Collection is shared by every caller of the deployment: one at a time, and " +
            "the next no sooner than 10 seconds after the last one ends, so polling faster than " +
            "that does not make events arrive sooner. A call that arrives while a collection is " +
            "already running, or when the network is slow, answers with what is recorded, and " +
            "the event appears on a later call; a background poller also collects every minute. " +
            "A confirmed `execute/submit` records its own events before it returns.",
          "",
          'A swap is `kind: PAYOUT` with `topic: "swap"` and `data` ' +
            "`{ assetIn, assetOut, amountIn, amountOut }`; amounts are stroops as strings.",
          "",
          "To poll: store `nextCursor` and pass it back as `cursor`. While `hasMore` is true, ask " +
            "again straight away; once it is false, wait and ask again with the same cursor. " +
            "`nextCursor` is never null once the deployment has events: on an empty page it echoes " +
            "the cursor you sent. It is null only when there are no events and no cursor was sent.",
          "",
          rate(V1_RATE_LIMITS.events, "per token"),
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        parameters: [
          deploymentIdParam,
          {
            name: "cursor",
            in: "query",
            required: false,
            description:
              "Opaque cursor from a previous response's `nextCursor`. Omit to start from the first event. An empty or altered value is a 422.",
            schema: { type: "string", minLength: 1, maxLength: 512 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "txHash",
            in: "query",
            required: false,
            description:
              "Only events from this transaction, e.g. the `txHash` `execute/submit` returned.",
            schema: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
          },
        ],
        responses: {
          "200": {
            description: "A page of events.",
            content: json(
              dataEnvelope("#/components/schemas/ListEventsResponse"),
              examples.eventsResponse,
            ),
          },
          ...errorsFor({ VALIDATION: examples.eventsError422 })(
            "UNAUTHENTICATED",
            "NOT_FOUND",
            "VALIDATION",
            "RATE_LIMITED",
          ),
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        tags: ["Spec"],
        operationId: "getOpenApi",
        summary: "This OpenAPI document",
        description: `Public; no token. Returned as the bare document, without the \`data\` envelope. ${rate(V1_RATE_LIMITS.openapi, "per client IP")}`,
        security: [],
        responses: {
          "200": {
            description: "The OpenAPI 3.1 document.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          ...errors("RATE_LIMITED"),
        },
      },
    },
    "/api/v1/demo-token": {
      post: {
        tags: ["Demo"],
        operationId: "createDemoToken",
        summary: "Get a short-lived token for the public demo deployment",
        description: [
          "Public; no token and no account. Returns a bearer token for one shared swapper " +
            "deployment on testnet, so you can run the calls above before registering. Takes no " +
            "body. Available only where the public demo is enabled (the testnet instance); 403 " +
            "otherwise.",
          "",
          "**This deployment is shared.** Anyone else holding a demo token can read the events " +
            "your deposit produces, including the account you deposited from. The swap proceeds " +
            "are paid to a Paiflow-owned testnet account, not back to you, so the testnet XLM you " +
            "deposit is spent. Fund a throwaway account with friendbot and never point this at an " +
            "account you care about.",
          "",
          "For an isolated deployment and a token that does not expire in an hour, register, " +
            "deploy your own flow and mint a token in the **API access** panel.",
          "",
          `${rate(V1_RATE_LIMITS.demoToken, "per client IP")} ${rate(V1_RATE_LIMITS.demoTokenGlobal, "instance-wide")}`,
        ].join("\n"),
        security: [],
        responses: {
          "201": {
            description: "A demo token. Shown once; it expires in 60 minutes.",
            content: json(
              dataEnvelope("#/components/schemas/DemoToken"),
              examples.demoTokenResponse,
            ),
          },
          ...demoErrors("FORBIDDEN", "RATE_LIMITED", "INTERNAL"),
        },
      },
    },
    "/api/deployments/{id}/api-tokens": {
      get: {
        tags: ["Token management (owner session)"],
        operationId: "listApiTokens",
        summary: "List the deployment's API tokens",
        description: `Owner session only. Active tokens first, then revoked and expired ones, each newest first; at most 100. Never returns a token's plaintext or hash. ${TOKEN_ROUTES_RATE}`,
        security: [{ cookieAuth: [] }],
        parameters: [deploymentIdParam],
        responses: {
          "200": {
            description: "The tokens.",
            content: json(
              {
                type: "object",
                required: ["data"],
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/ApiToken" } },
                },
              },
              examples.tokenListResponse,
            ),
          },
          ...sessionErrors("UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"),
        },
      },
      post: {
        tags: ["Token management (owner session)"],
        operationId: "createApiToken",
        summary: "Mint a deployment API token",
        description: `Owner session only, on a \`CONFIRMED\` deployment, at most 10 active tokens. The plaintext \`token\` is in this response and nowhere else: store it now. ${TOKEN_ROUTES_RATE}`,
        security: [{ cookieAuth: [] }],
        parameters: [deploymentIdParam],
        requestBody: {
          required: true,
          content: json(
            { $ref: "#/components/schemas/CreateApiTokenRequest" },
            examples.createTokenRequest,
          ),
        },
        responses: {
          "201": {
            description: "The new token, with its plaintext.",
            content: json(
              dataEnvelope("#/components/schemas/CreatedApiToken"),
              examples.createTokenResponse,
            ),
          },
          ...sessionErrors(
            "UNAUTHENTICATED",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "VALIDATION",
            "RATE_LIMITED",
          ),
        },
      },
    },
    "/api/deployments/{id}/api-tokens/{tokenId}": {
      delete: {
        tags: ["Token management (owner session)"],
        operationId: "revokeApiToken",
        summary: "Revoke a deployment API token",
        description: `Owner session only. Takes effect on the next request. The row is kept for the audit trail; revoking an already-revoked token returns it unchanged. ${TOKEN_ROUTES_RATE}`,
        security: [{ cookieAuth: [] }],
        parameters: [
          deploymentIdParam,
          {
            name: "tokenId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The revoked token.",
            content: json(dataEnvelope("#/components/schemas/ApiToken")),
          },
          ...sessionErrors("UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      webhookSecret: {
        type: "apiKey",
        in: "header",
        name: "x-webhook-secret",
        description: "The webhook deployment's server-only callback secret.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "pfk_<64 hex> or pfd_<64 hex>",
        description:
          "Server-side pfk_ deployment token from API access, or pfd_ developer token from /account/developer. Both use 64 lowercase hex characters and one-time reveal. Developer permission and explicit grants are rechecked on each request; no pkdev_ or session fallback. READ_ONLY permits reads; READ_OPERATE permits supported writes including relayer early release. Wallet consent and webhook secrets remain separate.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-paiflow.session",
        description: "The owner's signed-in browser session. Not available to machine callers.",
      },
    },
    schemas: {
      DeveloperToken: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(developerMetadataProperties),
        properties: developerMetadataProperties,
      },
      CreatedDeveloperToken: {
        type: "object",
        additionalProperties: false,
        required: [...Object.keys(developerMetadataProperties), "token"],
        properties: {
          ...developerMetadataProperties,
          token: {
            type: "string",
            pattern: "^pfd_[0-9a-f]{64}$",
            description: "One-time server-side credential; never log or send to analytics.",
          },
        },
      },
      CreateDeveloperTokenRequest: {
        type: "object",
        additionalProperties: false,
        required: ["permission", "deploymentIds"],
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Trimmed before validation.",
          },
          permission: developerMetadataProperties.permission,
          deploymentIds: { ...developerMetadataProperties.deploymentIds, minItems: 1 },
          expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
        },
      },
      UpdateDeveloperTokenRequest: {
        type: "object",
        additionalProperties: false,
        required: ["deploymentIds"],
        properties: { deploymentIds: developerMetadataProperties.deploymentIds },
      },
      DeveloperTokenList: {
        type: "object",
        required: ["items", "nextCursor"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/DeveloperToken" } },
          nextCursor: { type: ["string", "null"], format: "uuid" },
        },
      },
      DeveloperTokenDeploymentList: {
        type: "object",
        required: ["items", "nextCursor"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "flowName", "network"],
              properties: {
                id: { type: "string", format: "uuid" },
                flowName: { type: "string" },
                network: { type: "string" },
              },
            },
          },
          nextCursor: { type: ["string", "null"], format: "uuid" },
        },
      },
      SubscriptionControlPrepare: {
        type: "object",
        additionalProperties: false,
        required: ["walletAddress"],
        properties: {
          walletAddress: {
            type: "string",
            description: "Current configured subscriber's Stellar account address.",
          },
        },
      },
      WalletControlSubmit: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "signedXdr"],
        properties: {
          intent: { type: "string", format: "uuid" },
          signedXdr: { type: "string", minLength: 1, maxLength: 100000 },
        },
      },
      SubscriptionControlReconcile: {
        type: "object",
        additionalProperties: false,
        required: ["intent"],
        properties: { intent: { type: "string", format: "uuid" } },
      },
      SubscriptionControlPrepared: {
        type: "object",
        additionalProperties: false,
        required: [
          "intent",
          "txHash",
          "expiresAt",
          "xdr",
          "network",
          "networkPassphrase",
          "action",
          "walletAddress",
          "nodeId",
          "contractAddress",
          "tokenContractAddress",
        ],
        properties: {
          intent: { type: "string", format: "uuid" },
          txHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          expiresAt: { type: "string", format: "date-time" },
          xdr: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          networkPassphrase: { type: "string" },
          action: { type: "string", enum: ["subscription.cancel", "subscription.reactivate"] },
          walletAddress: { type: "string" },
          nodeId: { type: "string" },
          contractAddress: { type: "string" },
          tokenContractAddress: {
            type: "string",
            description: "Live token used when preparing, rather than stale graph asset metadata.",
          },
        },
      },
      SubscriptionControlReconciled: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "txHash", "action", "state", "ledger", "replacementAllowed"],
        properties: {
          intent: { type: "string", format: "uuid" },
          txHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          action: { type: "string", enum: ["subscription.cancel", "subscription.reactivate"] },
          state: {
            type: "string",
            enum: ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"],
          },
          ledger: { type: ["integer", "null"] },
          replacementAllowed: { type: "boolean" },
        },
      },
      ScheduleState: {
        type: "object",
        additionalProperties: false,
        required: [
          "deploymentId",
          "network",
          "nodeId",
          "contractAddress",
          "controller",
          "controlEligibility",
          "tokenContractAddress",
          "paused",
          "pauseAllowed",
          "retrieveAllowed",
          "balanceStroops",
          "availableStroops",
          "claimedStroops",
          "unvestedStroops",
          "retrievableStroops",
          "retrievalRecipient",
          "readAt",
        ],
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          nodeId: { type: "string" },
          contractAddress: { type: "string" },
          controller: { type: "string" },
          controlEligibility: {
            type: "object",
            additionalProperties: false,
            required: ["walletProtocolSupported", "pause", "resume", "retrieve"],
            properties: {
              walletProtocolSupported: { type: "boolean" },
              pause: { type: "boolean" },
              resume: { type: "boolean" },
              retrieve: { type: "boolean" },
            },
          },
          tokenContractAddress: { type: "string" },
          paused: { type: "boolean" },
          pauseAllowed: { type: "boolean" },
          retrieveAllowed: { type: "boolean" },
          balanceStroops: { type: "string", pattern: "^[0-9]+$" },
          availableStroops: { type: "string", pattern: "^[0-9]+$" },
          claimedStroops: { type: "string", pattern: "^[0-9]+$" },
          unvestedStroops: { type: "string", pattern: "^[0-9]+$" },
          retrievableStroops: { type: "string", pattern: "^[0-9]+$" },
          retrievalRecipient: { type: "string" },
          readAt: { type: "string", format: "date-time" },
        },
      },
      SchedulePrepared: {
        type: "object",
        required: [
          "intent",
          "txHash",
          "expiresAt",
          "unsignedXdr",
          "network",
          "action",
          "nodeId",
          "contractAddress",
          "walletAddress",
        ],
        properties: {
          intent: { type: "string", format: "uuid" },
          txHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          expiresAt: { type: "string", format: "date-time" },
          unsignedXdr: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          action: { type: "string", enum: ["pause", "resume", "retrieve"] },
          nodeId: { type: "string" },
          contractAddress: { type: "string" },
          walletAddress: { type: "string" },
          recipient: { type: "string", description: "Retrieval only: current contract controller" },
          estimatedAmountStroops: {
            type: "string",
            pattern: "^[0-9]+$",
            description:
              "Retrieval only: indicative holding balance minus available; actual ledger execution determines the amount",
          },
          tokenContractAddress: { type: "string", description: "Retrieval only: live token" },
        },
      },
      ScheduleReconciled: {
        type: "object",
        required: ["intent", "txHash", "network", "action", "state", "replacementAllowed"],
        properties: {
          intent: { type: "string", format: "uuid" },
          txHash: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          action: { type: "string", enum: ["pause", "resume", "retrieve"] },
          state: {
            type: "string",
            enum: ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"],
          },
          replacementAllowed: {
            type: "boolean",
            description: "True only for durable success/failure or ledger-proven expiry",
          },
        },
      },
      CapabilityOperation: {
        type: "object",
        additionalProperties: false,
        required: ["status", "authentication", "requirements", "nodeIds"],
        properties: {
          status: { type: "string", enum: ["supported", "conditional", "unsupported"] },
          authentication: {
            type: "string",
            enum: ["deployment_token", "webhook_secret", "subscriber_wallet"],
          },
          requirements: { type: "array", items: { type: "string" } },
          nodeIds: { type: "array", items: { type: "string" } },
        },
      },
      SwapQuote: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(SwapQuoteSchema.shape),
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          nodeId: { type: "string", minLength: 1 },
          contractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          assetInContractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          assetOutContractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          routerAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          pairAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          amountInStroops: {
            type: "string",
            pattern: "^[0-9]{1,39}$",
            description: "Positive i128 input amount.",
          },
          amountOutStroops: {
            type: "string",
            pattern: "^[0-9]{1,39}$",
            description: "Positive i128 estimated output.",
          },
          amountOutMinStroops: {
            type: "string",
            pattern: "^[0-9]{1,39}$",
            description: "Nonnegative i128 spot-less-slippage estimate at quote time.",
          },
          slippageBps: { type: "integer", minimum: 0, maximum: 10000 },
          readStartedAt: { type: "string", format: "date-time" },
          quotedAt: { type: "string", format: "date-time" },
          freshness: { type: "string", const: "live" },
          estimate: { type: "boolean", const: true },
          scope: { type: "string", const: "selected_node" },
          meetsMinimumAtQuote: { type: "boolean" },
        },
      },
      SubscriptionState: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(SubscriptionStateSchema.shape),
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          flowName: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          templateKind: { type: "string", enum: ["SUBSCRIPTION", "SUBSCRIPTION_DEV"] },
          contractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          tokenContractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          subscriber: { type: ["string", "null"], pattern: "^G[A-Z2-7]{55}$" },
          isCancelled: { type: "boolean" },
          setupRequired: { type: "boolean" },
          allowance: {
            type: "string",
            pattern: "^[0-9]+$",
            description: "Current allowance in stroops; nonnegative i128 range.",
          },
          assetLabel: { type: "string" },
          asset: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "native" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "symbol"],
                properties: { kind: { const: "known" }, symbol: { const: "USDC" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "code", "issuer"],
                properties: {
                  kind: { const: "custom" },
                  code: { type: "string", pattern: "^[A-Za-z0-9]{1,12}$" },
                  issuer: { type: "string", pattern: "^G[A-Z2-7]{55}$" },
                },
              },
              { type: "null" },
            ],
          },
        },
      },
      DeploymentBalances: {
        type: "object",
        additionalProperties: false,
        required: ["deploymentId", "network", "totals", "nodes", "freshness"],
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          totals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tokenContract", "balanceStroops"],
              properties: {
                tokenContract: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
                balanceStroops: { type: "string", pattern: "^\\d+$" },
              },
            },
          },
          nodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "nodeId",
                "templateKind",
                "contractAddress",
                "tokenContract",
                "balanceStroops",
                "readAt",
                "stale",
              ],
              properties: {
                nodeId: { type: "string", minLength: 1 },
                templateKind: { type: "string", minLength: 1 },
                contractAddress: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
                tokenContract: { type: ["string", "null"], pattern: "^C[A-Z2-7]{55}$" },
                balanceStroops: { type: ["string", "null"], pattern: "^\\d{1,39}$" },
                readAt: { type: ["string", "null"], format: "date-time" },
                stale: { type: "boolean" },
                error: { type: "string" },
              },
            },
          },
          freshness: {
            type: "object",
            additionalProperties: false,
            required: ["status", "totalsComplete", "attemptedAt", "cached"],
            properties: {
              status: { type: "string", enum: ["fresh", "partial", "stale"] },
              totalsComplete: { type: "boolean" },
              attemptedAt: { type: "string", format: "date-time" },
              cached: { type: "boolean" },
            },
          },
        },
      },
      DeploymentCapabilities: {
        type: "object",
        additionalProperties: false,
        description: DeploymentCapabilitiesSchema.description,
        required: [
          "deploymentId",
          "network",
          "configurationSource",
          "triggerType",
          "inputAsset",
          "operations",
        ],
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          configurationSource: { type: "string", const: "deployment_snapshot" },
          triggerType: {
            type: "string",
            enum: [
              "deposit",
              "webhook",
              "subscription",
              "payroll",
              "schedule",
              "oracle",
              "unknown",
            ],
          },
          inputAsset: {
            description: DeploymentCapabilitiesSchema.shape.inputAsset.description,
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "native", type: "string" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "symbol"],
                properties: {
                  kind: { const: "known", type: "string" },
                  symbol: { const: "USDC", type: "string" },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "code", "issuer"],
                properties: {
                  kind: { const: "custom", type: "string" },
                  code: { type: "string", pattern: "^[A-Za-z0-9]{1,12}$" },
                  issuer: { type: "string", pattern: "^G[A-Z2-7]{55}$" },
                },
              },
            ],
          },
          operations: {
            type: "object",
            additionalProperties: false,
            required: [
              "execute",
              "events",
              "balances",
              "funding",
              "transactions",
              "releaseEarly",
              "payouts",
              "webhook",
              "subscriptionAllowance",
              "subscriptionState",
              "scheduleState",
              "scheduleControls",
              "subscriptionCancel",
              "subscriptionReactivate",
              "swapQuote",
            ],
            properties: {
              execute: { $ref: "#/components/schemas/CapabilityOperation" },
              funding: { $ref: "#/components/schemas/CapabilityOperation" },
              balances: { $ref: "#/components/schemas/CapabilityOperation" },
              events: { $ref: "#/components/schemas/CapabilityOperation" },
              transactions: { $ref: "#/components/schemas/CapabilityOperation" },
              releaseEarly: { $ref: "#/components/schemas/CapabilityOperation" },
              payouts: { $ref: "#/components/schemas/CapabilityOperation" },
              webhook: { $ref: "#/components/schemas/CapabilityOperation" },
              subscriptionCancel: { $ref: "#/components/schemas/CapabilityOperation" },
              subscriptionReactivate: { $ref: "#/components/schemas/CapabilityOperation" },
              swapQuote: { $ref: "#/components/schemas/CapabilityOperation" },
              scheduleState: { $ref: "#/components/schemas/CapabilityOperation" },
              scheduleControls: { $ref: "#/components/schemas/CapabilityOperation" },
              subscriptionState: { $ref: "#/components/schemas/CapabilityOperation" },
              subscriptionAllowance: { $ref: "#/components/schemas/CapabilityOperation" },
            },
          },
        },
      },
      FundingPrepare: {
        type: "object",
        additionalProperties: false,
        required: ["fromAddress", "tokenContractAddress", "amountStroops"],
        properties: {
          nodeId: { type: "string", minLength: 1, maxLength: 128 },
          fromAddress: {
            type: "string",
            description: "Consenting funding wallet, Stellar G address",
          },
          tokenContractAddress: {
            type: "string",
            description: "Exact live deployed asset C address from funding discovery",
          },
          amountStroops: {
            type: "string",
            pattern: "^[1-9]\\d{0,38}$",
            description: "Positive integer stroops at most i128::MAX",
          },
        },
      },
      FundingSubmit: {
        type: "object",
        additionalProperties: false,
        required: ["action", "intent", "signedXdr"],
        properties: {
          action: { type: "string", enum: ["schedule.fund", "webhook.fund"] },
          intent: { type: "string", format: "uuid" },
          signedXdr: { type: "string", minLength: 1, maxLength: 100000 },
        },
      },
      FundingReconcile: {
        type: "object",
        additionalProperties: false,
        required: ["action", "intent"],
        properties: {
          action: { type: "string", enum: ["schedule.fund", "webhook.fund"] },
          intent: { type: "string", format: "uuid" },
        },
      },
      FundingDiscovery: {
        type: "object",
        additionalProperties: false,
        required: ["deploymentId", "network", "nodes"],
        properties: {
          deploymentId: { type: "string", format: "uuid" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          nodes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "nodeId",
                "templateKind",
                "contractAddress",
                "action",
                "tokenContractAddress",
                "authorization",
                "effect",
              ],
              properties: {
                nodeId: { type: "string" },
                templateKind: { type: "string", enum: ["STREAMER", "WEBHOOK"] },
                contractAddress: { type: "string" },
                action: { type: "string", enum: ["schedule.fund", "webhook.fund"] },
                tokenContractAddress: { type: "string" },
                authorization: { const: "funding_wallet" },
                effect: { type: "string" },
              },
            },
          },
        },
      },
      FundingPrepared: {
        type: "object",
        additionalProperties: false,
        required: [
          "intent",
          "txHash",
          "expiresAt",
          "xdr",
          "action",
          "nodeId",
          "fromAddress",
          "tokenContractAddress",
          "amountStroops",
          "network",
          "networkPassphrase",
        ],
        properties: {
          intent: { type: "string", format: "uuid" },
          txHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          expiresAt: { type: "string", format: "date-time" },
          xdr: { type: "string" },
          action: { type: "string", enum: ["schedule.fund", "webhook.fund"] },
          nodeId: { type: "string" },
          fromAddress: { type: "string" },
          tokenContractAddress: { type: "string" },
          amountStroops: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          networkPassphrase: { type: "string" },
        },
      },
      FundingReconciled: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "action", "txHash", "network", "state", "expiresAt"],
        properties: {
          intent: { type: "string", format: "uuid" },
          action: { type: "string", enum: ["schedule.fund", "webhook.fund"] },
          txHash: { type: "string" },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          state: {
            type: "string",
            enum: ["PREPARED", "SUBMITTING", "SUCCESS", "FAILED", "EXPIRED"],
          },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: Object.keys(ERROR_STATUS) },
              message: { type: "string" },
              fields: {
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
                description: "Per-field validation messages, keyed by field path.",
              },
              details: {
                type: "string",
                description: "Raw technical detail, e.g. a Soroban simulation diagnostic.",
              },
            },
          },
        },
      },
      ExecutePrepareRequest: {
        type: "object",
        additionalProperties: false,
        required: ["amount", "from"],
        description: EXECUTE_PREREQUISITES,
        properties: {
          amount: {
            type: "string",
            pattern: "^\\d{1,39}$",
            description: `${executeShape.amount.description} Greater than zero.`,
          },
          from: {
            type: "string",
            pattern: "^G[A-Z2-7]{55}$",
            description: executeShape.from.description,
          },
        },
      },
      ExecutePrepared: {
        type: "object",
        required: ["xdr", "networkPassphrase", "network", "expiresAt"],
        description: ExecutePreparedSchema.description,
        properties: {
          xdr: { type: "string", description: preparedShape.xdr.description },
          networkPassphrase: {
            type: "string",
            description: preparedShape.networkPassphrase.description,
          },
          network: { type: "string", enum: ["testnet", "mainnet"] },
          expiresAt: {
            type: "string",
            format: "date-time",
            description: preparedShape.expiresAt.description,
          },
        },
      },
      ExecuteSubmitRequest: {
        type: "object",
        additionalProperties: false,
        required: ["signedXdr"],
        properties: {
          signedXdr: {
            type: "string",
            minLength: 10,
            maxLength: 200000,
            description: ExecuteSubmitSchema.shape.signedXdr.description,
          },
        },
      },
      WebhookAttemptResponse: {
        type: "object",
        required: ["attemptId", "network", "status"],
        properties: {
          attemptId: { type: "string", format: "uuid" },
          txHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          network: { type: "string", enum: WebhookAttemptResponseSchema.shape.network.options },
          status: { type: "string", enum: WebhookAttemptResponseSchema.shape.status.options },
          ledger: { type: "integer", minimum: 1 },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
      TransactionStatus: {
        type: "object",
        required: ["txHash", "network", "status"],
        properties: {
          txHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          network: { type: "string", enum: TransactionStatusSchema.shape.network.options },
          status: { type: "string", enum: TransactionStatusSchema.shape.status.options },
          ledger: { type: "integer", minimum: 1 },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
      ExecuteSubmitted: {
        type: "object",
        required: ["txHash", "status"],
        description: ExecuteSubmittedSchema.description,
        properties: {
          txHash: { type: "string", description: submittedShape.txHash.description },
          status: {
            type: "string",
            enum: ["SUCCESS", "PENDING", "FAILED"],
            description: submittedShape.status.description,
          },
          ledger: { type: "integer", description: "Ledger the transaction was final in." },
          error: {
            type: "object",
            required: ["code", "message"],
            description: "Present when `status` is `FAILED`.",
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
      ReleaseBeforeRequest: {
        type: "object",
        additionalProperties: false,
        description: ReleaseBeforeSchema.description,
        properties: {
          nodeId: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description: releaseShape.nodeId.description,
          },
        },
      },
      Released: {
        type: "object",
        required: ["nodeId", "txHash"],
        description: ReleasedSchema.description,
        properties: {
          nodeId: { type: "string", description: releasedShape.nodeId.description },
          txHash: { type: "string", description: releasedShape.txHash.description },
          ledger: { type: "integer", description: "Ledger the transaction was final in." },
        },
      },
      ContractEvent: {
        type: "object",
        required: ["id", "eventId", "kind", "topic", "ledger", "txHash", "occurredAt", "data"],
        properties: {
          id: { type: "string", format: "uuid" },
          eventId: { type: "string", description: "The network's event id; unique." },
          kind: {
            type: "string",
            description: "The app's event kind, e.g. `RECEIVE`, `PAYOUT`, `STATUS_CHANGE`.",
          },
          topic: {
            type: ["string", "null"],
            description: "The event's first topic: `swap` for a swap, whose `kind` is `PAYOUT`.",
          },
          ledger: { type: "integer" },
          txHash: { type: "string" },
          occurredAt: { type: "string", format: "date-time" },
          data: { description: "The decoded event body; `null` when the app does not decode it." },
        },
      },
      ListEventsResponse: {
        type: "object",
        required: ["items", "nextCursor", "hasMore"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/ContractEvent" } },
          nextCursor: {
            type: ["string", "null"],
            description:
              "Pass back as `cursor`. Null only when the deployment has no events and no cursor was sent.",
          },
          hasMore: { type: "boolean", description: "True when another page is ready now." },
        },
      },
      CreateApiTokenRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", minLength: 1, maxLength: 64 },
          expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
        },
      },
      ApiToken: {
        type: "object",
        required: [
          "id",
          "tokenPrefix",
          "label",
          "createdAt",
          "lastUsedAt",
          "expiresAt",
          "revokedAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          tokenPrefix: { type: "string", description: "First 12 characters, for recognition." },
          label: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          expiresAt: { type: ["string", "null"], format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      DemoToken: {
        type: "object",
        required: ["deploymentId", "token", "expiresAt"],
        description: DemoTokenSchema.description,
        properties: {
          deploymentId: {
            type: "string",
            format: "uuid",
            description: demoShape.deploymentId.description,
          },
          token: { type: "string", description: demoShape.token.description },
          expiresAt: {
            type: "string",
            format: "date-time",
            description: demoShape.expiresAt.description,
          },
        },
      },
      CreatedApiToken: {
        allOf: [
          { $ref: "#/components/schemas/ApiToken" },
          {
            type: "object",
            required: ["token"],
            properties: {
              token: { type: "string", description: "The plaintext token. Shown once." },
            },
          },
        ],
      },
    },
  },
};
