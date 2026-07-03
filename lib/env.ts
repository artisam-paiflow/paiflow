import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalWasmHash = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || /^[0-9a-f]{64}$/i.test(v), {
    message: "WASM hash must be a 64-character hex string",
  });

// Stellar memo IDs are numeric (uint64). Kept as a string to avoid precision
// loss; validated at config load so a swapped/misconfigured PDAX memo fails at
// startup rather than mid-way through a live off-ramp job.
const optionalNumericMemo = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || /^\d+$/.test(v), {
    message: "PDAX deposit memo must be a numeric string (Stellar memo id)",
  });

// PDAX deposit address must be a well-formed Stellar account (ed25519 G-address).
// Validated at config load so a typo'd/truncated address fails at startup rather
// than only when a live native-XLM deposit is attempted mid-job.
const optionalStellarAddress = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || StrKey.isValidEd25519PublicKey(v), {
    message: "PDAX deposit address must be a valid Stellar ed25519 public key (G...)",
  });

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"))
  .default(false);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  AUTH_URL: z.string().url().default("http://localhost:3000"),
  AUTH_RP_ID: z.string().default("localhost"),
  AUTH_RP_NAME: z.string().default("Paiflow"),
  ALLOW_PUBLIC_REGISTRATION: boolish,

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  // Network is pinned per environment: staging/dev = testnet, prod = mainnet.
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  STELLAR_NETWORK_PASSPHRASE_TESTNET: z.string().default("Test SDF Network ; September 2015"),
  STELLAR_HORIZON_URL_TESTNET: z.string().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_SOROBAN_RPC_URL_TESTNET: z.string().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE_MAINNET: z
    .string()
    .default("Public Global Stellar Network ; September 2015"),
  STELLAR_HORIZON_URL_MAINNET: z.string().url().default("https://horizon.stellar.org"),
  STELLAR_SOROBAN_RPC_URL_MAINNET: z.string().url().default("https://mainnet.sorobanrpc.com"),
  // Friendbot is testnet-only; undefined on mainnet.
  STELLAR_FRIENDBOT_URL: optionalString,

  STELLAR_WASM_HASH_SPLITTER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_STREAMER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_CONDITIONAL_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_DEPOSIT_TRIGGER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_ROUTER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_TIMELOCK_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SPLITTER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_STREAMER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_CONDITIONAL_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_DEPOSIT_TRIGGER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_ROUTER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_TIMELOCK_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_FACTORY_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_FACTORY_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_WEBHOOK_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_WEBHOOK_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_SUBSCRIPTION_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SUBSCRIPTION_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_ORACLE_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_ORACLE_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_MULTISIG_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_MULTISIG_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_SWAPPER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SWAPPER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_YIELD_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_YIELD_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYER_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYROLL_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYROLL_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYER_DEV_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_PAYER_DEV_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_SPLITTER_DEV_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SPLITTER_DEV_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_SUBSCRIPTION_DEV_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SUBSCRIPTION_DEV_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_CASH_OUT_DEV_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_CASH_OUT_DEV_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_CASH_OUT_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_CASH_OUT_MAINNET: optionalWasmHash,
  STELLAR_FACTORY_ADDRESS_TESTNET: optionalString,
  STELLAR_FACTORY_ADDRESS_MAINNET: optionalString,

  // ---- Relayer ----
  // Used for auto-releasing timelock contracts and for signing webhook
  // trigger transactions. Optional; when unset the admin address is used
  // as the relayer, disabling the relayer path.
  STELLAR_RELAYER_SECRET_KEY: optionalString,
  STELLAR_RELAYER_ADDRESS: optionalString,

  // ---- Off-ramp treasury ----
  // Relayer-controlled holding address that cash_out nodes sink USDC to before
  // the off-chain PDAX leg. When unset, the relayer address is used.
  OFFRAMP_TREASURY_ADDRESS_TESTNET: optionalString,
  OFFRAMP_TREASURY_ADDRESS_MAINNET: optionalString,

  // PDAX deposit address and memo/tag for native XLM off-ramp deposits.
  // When set, process-offramp-jobs will forward XLM from the treasury to PDAX
  // before executing the trade. Required only for the XLM -> PHP flow.
  OFFRAMP_PDAX_DEPOSIT_ADDRESS_TESTNET: optionalStellarAddress,
  OFFRAMP_PDAX_DEPOSIT_ADDRESS_MAINNET: optionalStellarAddress,
  OFFRAMP_PDAX_DEPOSIT_MEMO_TESTNET: optionalNumericMemo,
  OFFRAMP_PDAX_DEPOSIT_MEMO_MAINNET: optionalNumericMemo,

  CRON_SECRET: optionalString,
  // Secret token for machine-to-machine calls to the /api/deployments/:id/dev-*
  // endpoints. When present, callers can authenticate by sending the header
  // x-dev-api-secret: <token> instead of a user session.
  DEV_API_SECRET: optionalString,
  SENTRY_DSN: optionalString,
  HIBP_CHECK_ENABLED: boolish,

  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalString,
  AI_MODEL: optionalString,

  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
  GROQ_STT_MODEL_PRIMARY: optionalString,
  GROQ_STT_MODEL_FALLBACK: optionalString,

  // ---- Off-ramp provider (e.g. PDAX) ----
  OFFRAMP_PROVIDER: z.enum(["pdax", "mock"]).default("mock"),
  OFFRAMP_API_URL: optionalString,
  // PDAX uses Bearer tokens. ACCESS_TOKEN is the current access token;
  // REFRESH_TOKEN + USERNAME are used to obtain a new access token when it
  // expires. OFFRAMP_API_KEY and OFFRAMP_ID_TOKEN are legacy fields kept for
  // backwards compatibility but are not used for Bearer auth.
  OFFRAMP_API_KEY: optionalString,
  OFFRAMP_ACCESS_TOKEN: optionalString,
  OFFRAMP_REFRESH_TOKEN: optionalString,
  OFFRAMP_USERNAME: optionalString,
  OFFRAMP_ID_TOKEN: optionalString,
  OFFRAMP_WEBHOOK_SECRET: optionalString,
  OFFRAMP_ASSET_CODE: optionalString,
  OFFRAMP_NETWORK: optionalString,
  OFFRAMP_CHANNEL: optionalString,

  // ---- Email (Resend) ----
  // Optional in dev — when RESEND_API_KEY is unset, `lib/mail.ts` logs the
  // payload to stdout instead of delivering. Required in prod.
  RESEND_API_KEY: optionalString,
  // Default kicks in when unset OR empty (.env.example ships `EMAIL_FROM=`).
  // Don't add `.min(3)` here — that runs before the transform and crashes
  // env() on the empty-string case the default is meant to catch.
  EMAIL_FROM: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : "Paiflow <onboarding@resend.dev>")),
});

type EnvShape = z.infer<typeof EnvSchema>;

let cached: EnvShape | null = null;

export function env(): EnvShape {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export type StellarNetworkName = "testnet" | "mainnet";

function assertActiveNetwork(network: StellarNetworkName): void {
  const active = env().STELLAR_NETWORK;
  if (active !== network) {
    throw new Error(
      `Stellar network mismatch: requested ${network} but STELLAR_NETWORK=${active}. ` +
        `Pin the environment via STELLAR_NETWORK; don't request the wrong network at runtime.`,
    );
  }
}

export function stellarRpcUrl(network?: StellarNetworkName): string {
  const e = env();
  if (network) assertActiveNetwork(network);
  return e.STELLAR_NETWORK === "mainnet"
    ? e.STELLAR_SOROBAN_RPC_URL_MAINNET
    : e.STELLAR_SOROBAN_RPC_URL_TESTNET;
}

export function stellarHorizonUrl(network?: StellarNetworkName): string {
  const e = env();
  if (network) assertActiveNetwork(network);
  return e.STELLAR_NETWORK === "mainnet"
    ? e.STELLAR_HORIZON_URL_MAINNET
    : e.STELLAR_HORIZON_URL_TESTNET;
}

export function stellarPassphrase(network?: StellarNetworkName): string {
  const e = env();
  if (network) assertActiveNetwork(network);
  return e.STELLAR_NETWORK === "mainnet"
    ? e.STELLAR_NETWORK_PASSPHRASE_MAINNET
    : e.STELLAR_NETWORK_PASSPHRASE_TESTNET;
}

// Friendbot is testnet-only. Throws on mainnet so callers fail fast.
export function stellarFriendbotUrl(): string {
  const e = env();
  if (e.STELLAR_NETWORK === "mainnet") {
    throw new Error("Friendbot is not available on mainnet");
  }
  if (!e.STELLAR_FRIENDBOT_URL) {
    throw new Error("STELLAR_FRIENDBOT_URL is required when STELLAR_NETWORK=testnet");
  }
  return e.STELLAR_FRIENDBOT_URL;
}

export function stellarWasmHash(
  kind:
    | "SPLITTER"
    | "STREAMER"
    | "CONDITIONAL"
    | "DEPOSIT_TRIGGER"
    | "ROUTER"
    | "TIMELOCK"
    | "FACTORY"
    | "WEBHOOK"
    | "SUBSCRIPTION"
    | "ORACLE"
    | "MULTISIG"
    | "SWAPPER"
    | "YIELD"
    | "PAYER"
    | "PAYROLL"
    | "PAYER_DEV"
    | "SPLITTER_DEV"
    | "SUBSCRIPTION_DEV"
    | "CASH_OUT_DEV"
    | "CASH_OUT",
): string | undefined {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const key = `STELLAR_WASM_HASH_${kind}_${suffix}` as keyof EnvShape;
  return e[key] as string | undefined;
}

export function stellarFactoryAddress(): string | undefined {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const key = `STELLAR_FACTORY_ADDRESS_${suffix}` as keyof EnvShape;
  return e[key] as string | undefined;
}

export function stellarRelayerSecretKey(): string | undefined {
  return env().STELLAR_RELAYER_SECRET_KEY;
}

export function stellarRelayerAddress(): string | undefined {
  return env().STELLAR_RELAYER_ADDRESS;
}

/**
 * Address that cash_out nodes sink USDC to before the off-chain PDAX leg.
 * Falls back to the relayer address when no dedicated treasury is configured.
 */
export function offRampTreasuryAddress(): string | undefined {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const key = `OFFRAMP_TREASURY_ADDRESS_${suffix}` as keyof EnvShape;
  return (e[key] as string | undefined) ?? e.STELLAR_RELAYER_ADDRESS;
}

/**
 * PDAX deposit credentials for native XLM off-ramps. When both address and memo
 * are configured, the cron will deposit job XLM from the treasury to PDAX before
 * quoting/trading. Memo is the numeric tag PDAX requires to credit the deposit.
 */
export function offRampPdaxDepositConfig(): {
  address: string | undefined;
  memo: string | undefined;
} {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const addressKey = `OFFRAMP_PDAX_DEPOSIT_ADDRESS_${suffix}` as keyof EnvShape;
  const memoKey = `OFFRAMP_PDAX_DEPOSIT_MEMO_${suffix}` as keyof EnvShape;
  return {
    address: e[addressKey] as string | undefined,
    memo: e[memoKey] as string | undefined,
  };
}
