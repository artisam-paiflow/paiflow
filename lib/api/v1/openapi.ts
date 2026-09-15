import {
  EXECUTE_PREREQUISITES,
  ExecutePrepareSchema,
  ExecutePreparedSchema,
  ExecuteSubmitQuerySchema,
  ExecuteSubmitSchema,
  ExecuteSubmittedSchema,
} from "./schema";
import { V1_RATE_LIMITS } from "./limits";

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

export const examples = {
  executeRequest: { amount: "1000000000", from: EXAMPLE_FROM },
  executeResponse: {
    data: {
      xdr: "AAAAAgAAAADYXPYQYOTpvJD2BAs8oB9ej3hbUuLzjbut2WPA6+L0OQAB6IQADc4pAAAAAQAAAAEAAAAAAAAAAAAAAABmxy2kAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB…(truncated)",
      networkPassphrase: "Test SDF Network ; September 2015",
      network: "testnet",
      expiresAt: "2026-09-15T09:03:00.000Z",
    },
  },
  submitRequest: {
    signedXdr:
      "AAAAAgAAAADYXPYQYOTpvJD2BAs8oB9ej3hbUuLzjbut2WPA6+L0OQAB6IQADc4pAAAAAQAAAAEAAAAAAAAAAAAAAABmxy2kAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB…(truncated)",
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
      token: "pfk_3f9a1c7e0b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a",
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
  error422: {
    error: {
      code: "VALIDATION",
      message: "Invalid input",
      fields: { amount: ["Must be a whole number of stroops"] },
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
  RATE_LIMITED: "Too many requests in the window.",
  INTERNAL: "Unexpected server error.",
  UPSTREAM_RPC: "The Soroban RPC request failed or the network was busy; retry.",
};

const errors = (...codes: ErrorCode[]) =>
  Object.fromEntries(
    codes.map((code) => [
      String(ERROR_STATUS[code]),
      errorResponse(
        `\`${code}\`: ${ERROR_DESCRIPTIONS[code]}`,
        code === "UNAUTHENTICATED"
          ? examples.error401
          : code === "VALIDATION"
            ? examples.error422
            : undefined,
      ),
    ]),
  );

const deploymentIdParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Deployment id (UUID). A malformed id is a 404.",
  schema: { type: "string", format: "uuid" },
  example: EXAMPLE_DEPLOYMENT_ID,
};

const errorTable = (Object.keys(ERROR_STATUS) as ErrorCode[])
  .map((code) => `| \`${code}\` | ${ERROR_STATUS[code]} |`)
  .join("\n");

const executeShape = ExecutePrepareSchema.shape;
const preparedShape = ExecutePreparedSchema.shape;
const submittedShape = ExecuteSubmittedSchema.shape;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Paiflow API v1",
    version: "1.0.0",
    description: [
      "Execute a deployed swapper flow and poll its on-chain events from your own backend.",
      "",
      "Every `/api/v1/deployments/{id}/…` call authenticates with a deployment API token " +
        "(`Authorization: Bearer pfk_…`) that the deployment's owner mints in the **API access** " +
        "panel on the deployment page. A token reaches exactly one deployment.",
      "",
      "**The API never signs.** `execute` returns an unsigned envelope; you sign it with the " +
        "`from` key, which stays on your side, and post it to `execute/submit`. A leaked token can " +
        "only prepare and relay what you signed.",
      "",
      'Successful responses are `{ "data": … }`. Errors are `{ "error": { code, message, fields?, details? } }`:',
      "",
      "| Code | HTTP status |",
      "| --- | --- |",
      errorTable,
      "",
      "The public instance runs on Stellar **testnet**. Guide: `docs/api/README.md`.",
    ].join("\n"),
  },
  servers: [{ url: "https://paiflow.xyz", description: "Public instance (Stellar testnet)" }],
  tags: [
    { name: "Execute", description: "Run a swapper flow: prepare, sign on your side, submit." },
    { name: "Events", description: "Cursor-based polling of a deployment's decoded events." },
    { name: "Spec", description: "This document." },
    {
      name: "Token management (owner session)",
      description:
        "How deployment tokens are minted and revoked. These are the owner's signed-in session " +
        "routes behind the API access panel, not part of the token-authenticated API: they take " +
        "the session cookie, never a deployment token, and a sandbox session is refused.",
    },
  ],
  paths: {
    "/api/v1/deployments/{id}/execute": {
      post: {
        tags: ["Execute"],
        operationId: "prepareExecute",
        summary: "Prepare the unsigned deposit that executes a swapper flow",
        description: [
          ExecutePrepareSchema.description,
          "",
          "The flow runs through its deposit trigger; the swapper executes as the next pipeline " +
            "step. Sign the returned `xdr` with the `from` key using `networkPassphrase`, before " +
            "`expiresAt`, and post it to `execute/submit`. Only swapper flows can be executed.",
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
          {
            name: "wait",
            in: "query",
            required: false,
            description: `${ExecuteSubmitQuerySchema.shape.wait.description} Default \`true\`: wait up to about 25 seconds for a final status, then return \`PENDING\` if there is none yet.`,
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
          ...errors("UNAUTHENTICATED", "NOT_FOUND", "VALIDATION", "RATE_LIMITED", "UPSTREAM_RPC"),
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
            "appears once (`eventId` is unique), and it can trail the chain by about a minute, " +
            "because events arrive from a one-minute poller (a confirmed `execute/submit` ingests " +
            "its own events straight away).",
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
          ...errors("UNAUTHENTICATED", "NOT_FOUND", "VALIDATION", "RATE_LIMITED"),
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
    "/api/deployments/{id}/api-tokens": {
      get: {
        tags: ["Token management (owner session)"],
        operationId: "listApiTokens",
        summary: "List the deployment's API tokens",
        description:
          "Owner session only. Active tokens first, then revoked and expired ones, each newest first; at most 100. Never returns a token's plaintext or hash.",
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
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"),
        },
      },
      post: {
        tags: ["Token management (owner session)"],
        operationId: "createApiToken",
        summary: "Mint a deployment API token",
        description:
          "Owner session only, on a `CONFIRMED` deployment, at most 10 active tokens. The plaintext `token` is in this response and nowhere else: store it now.",
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
          ...errors(
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
        description:
          "Owner session only. Takes effect on the next request. The row is kept for the audit trail; revoking an already-revoked token returns it unchanged.",
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
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "pfk_<64 hex>",
        description:
          "A deployment API token, minted by the deployment's owner in the API access panel and shown once.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-paiflow.session",
        description: "The owner's signed-in browser session. Not available to machine callers.",
      },
    },
    schemas: {
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
