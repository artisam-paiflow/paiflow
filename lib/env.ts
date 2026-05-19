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

  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  STELLAR_NETWORK_PASSPHRASE_TESTNET: z.string().default("Test SDF Network ; September 2015"),
  STELLAR_HORIZON_URL_TESTNET: z.string().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_SOROBAN_RPC_URL_TESTNET: z.string().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_FRIENDBOT_URL: z.string().url().default("https://friendbot.stellar.org"),
  ENABLE_MAINNET: boolish,

  STELLAR_WASM_HASH_SPLITTER: optionalString,
  STELLAR_WASM_HASH_STREAMER: optionalString,
  STELLAR_WASM_HASH_CONDITIONAL: optionalString,

  CRON_SECRET: optionalString,
  SENTRY_DSN: optionalString,
  HIBP_CHECK_ENABLED: boolish,

  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalString,
  AI_MODEL: optionalString,

  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,

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

export function stellarRpcUrl(): string {
  const e = env();
  return e.STELLAR_NETWORK === "mainnet"
    ? (process.env.STELLAR_SOROBAN_RPC_URL_MAINNET ?? "")
    : e.STELLAR_SOROBAN_RPC_URL_TESTNET;
}

export function stellarHorizonUrl(): string {
  const e = env();
  return e.STELLAR_NETWORK === "mainnet"
    ? (process.env.STELLAR_HORIZON_URL_MAINNET ?? "")
    : e.STELLAR_HORIZON_URL_TESTNET;
}

export function stellarPassphrase(): string {
  const e = env();
  return e.STELLAR_NETWORK === "mainnet"
    ? (process.env.STELLAR_NETWORK_PASSPHRASE_MAINNET ??
        "Public Global Stellar Network ; September 2015")
    : e.STELLAR_NETWORK_PASSPHRASE_TESTNET;
}
