import "server-only";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

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
  AUTH_RP_NAME: z.string().default("Pink Raft"),
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

  STELLAR_WASM_HASH_SPLITTER_TESTNET: optionalString,
  STELLAR_WASM_HASH_STREAMER_TESTNET: optionalString,
  STELLAR_WASM_HASH_CONDITIONAL_TESTNET: optionalString,
  STELLAR_WASM_HASH_SPLITTER_MAINNET: optionalString,
  STELLAR_WASM_HASH_STREAMER_MAINNET: optionalString,
  STELLAR_WASM_HASH_CONDITIONAL_MAINNET: optionalString,

  CRON_SECRET: optionalString,
  SENTRY_DSN: optionalString,
  HIBP_CHECK_ENABLED: boolish,

  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalString,
  AI_MODEL: optionalString,

  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
  GROQ_STT_MODEL_PRIMARY: optionalString,
  GROQ_STT_MODEL_FALLBACK: optionalString,

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
    .transform((v) => (v && v.length > 0 ? v : "Pink Raft <onboarding@resend.dev>")),
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

export function stellarWasmHash(kind: "SPLITTER" | "STREAMER" | "CONDITIONAL"): string | undefined {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const key = `STELLAR_WASM_HASH_${kind}_${suffix}` as keyof EnvShape;
  return e[key] as string | undefined;
}
