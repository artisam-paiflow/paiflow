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

// A row id handed to Prisma. Validated at config load so a typo'd id fails at
// startup rather than surfacing as a Prisma error on the first request.
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
    message: "must be a UUID",
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

// Browser origins a passkey may be used from, comma-separated. WebAuthn compares the
// origin the browser actually sent — scheme, host, port, nothing else — against each
// entry verbatim, so an entry carrying a path, a query, a fragment or credentials can
// never match: it would fail every verification silently rather than at startup. Those
// are refused, because the operator meant something this setting cannot express. A
// trailing slash is the exception — it is what copying an address bar produces and it
// denotes the same origin — so entries are stored as `new URL(v).origin`.
//
// Blank (or unset) yields [], which lib/passkey/rp.ts reads as "fall back to AUTH_URL".
// A value that is non-blank but lists nothing (", ,") is a typo, and falling back there
// would quietly point passkeys at AUTH_URL's host — the failure this whole setting exists
// to prevent. Refused too.
const originList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const raw = (v ?? "").trim();
    if (raw.length === 0) return [];

    const entries = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (entries.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lists no origins" });
      return z.NEVER;
    }

    const origins: string[] = [];
    for (const entry of entries) {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" is not a URL; each entry must be an origin like https://app.example.com`,
        });
        return z.NEVER;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" must use http or https`,
        });
        return z.NEVER;
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" must be a bare origin (scheme, host, optional port) — a browser never sends a path, query or credentials as its origin`,
        });
        return z.NEVER;
      }
      origins.push(url.origin);
    }
    return origins;
  });

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"))
  .default(false);

const boolishDefault = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"))
    .default(defaultValue);

// A surface switch (#722): unset or blank is ON, so nothing changes until an
// operator sets it. A value it cannot read is not a startup error, which would
// take every route (crons and live deployments included) down over a typo:
// it parses to "unrecognised", which lib/features.ts treats as OFF and warns
// about, so "flase" hides the surface rather than leaving it showing.
const featureSwitch = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v): boolean | "unrecognised" => {
    if (v === undefined) return true;
    if (typeof v === "boolean") return v;
    const s = v.trim().toLowerCase();
    if (s === "" || s === "true" || s === "1" || s === "on" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "off" || s === "no") return false;
    return "unrecognised" as const;
  });

// Soroswap router address, pinned per network. Validated at config load so a
// typo fails at startup rather than when the first swap flow is deployed.
const optionalContractAddress = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || StrKey.isValidContract(v), {
    message: "Must be a valid Stellar contract address (C...)",
  });

const optionalPositiveInt = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.length === 0) return defaultValue;
      const parsed = Number(v);
      if (!Number.isInteger(parsed) || parsed <= 0) return defaultValue;
      return parsed;
    });

const optionalNonNegativeInt = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.length === 0) return defaultValue;
      const parsed = Number(v);
      if (!Number.isInteger(parsed) || parsed < 0) return defaultValue;
      return parsed;
    });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  RAILWAY_ENVIRONMENT_NAME: optionalString,

  // ---- Temporary splitter/off-ramp hard limits ----
  // Exposed to the browser because validateFlow runs client-side. Whole-token
  // values are converted to stroops at validation time. Bounds are inclusive.
  // Set a bound to 0 to disable just that bound; set both min and max to 0 to
  // disable all hard-limit checks for that asset.
  //
  // These are soft, temporary business-rule knobs, so the schema is tolerant:
  // a malformed value (e.g. "150.5" or "abc") falls back to the default via
  // .catch() instead of failing EnvSchema and crashing env() for every route.
  // The enforcement path (lib/flows/limits.ts) parses these vars leniently on
  // its own because it also runs in the browser, where env() is unavailable.
  NEXT_PUBLIC_SPLITTER_XLM_MIN: z.coerce.number().int().nonnegative().default(150).catch(150),
  NEXT_PUBLIC_SPLITTER_XLM_MAX: z.coerce.number().int().nonnegative().default(500).catch(500),
  NEXT_PUBLIC_SPLITTER_USDC_MIN: z.coerce.number().int().nonnegative().default(30).catch(30),
  NEXT_PUBLIC_SPLITTER_USDC_MAX: z.coerce.number().int().nonnegative().default(110).catch(110),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  AUTH_URL: z.string().url().default("http://localhost:3000"),
  // One app service answers on several hostnames, so a single value cannot cover them
  // all. An allowlist — never a wildcard, never a request header. See `originList` above.
  AUTH_ORIGINS: originList,
  AUTH_RP_ID: z.string().default("localhost"),
  AUTH_RP_NAME: z.string().default("Paiflow"),
  ALLOW_PUBLIC_REGISTRATION: boolish,
  GOOGLE_AUTH_ENABLED: boolish,
  ALLOW_GOOGLE_REGISTRATION: boolish,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  // Offers a no-account, limited sandbox session from the login page.
  SANDBOX_ENABLED: boolish,

  // Hands any unauthenticated caller a short-lived token for one shared,
  // operator-provisioned swapper deployment, so the partner API can be tried
  // without an account. Both are refused on mainnet; see the guard in `env()`.
  DEMO_API_ENABLED: boolish,
  DEMO_API_DEPLOYMENT_ID: optionalUuid,

  // ---- Feature switches ----
  // Hide a surface and refuse new use of it; existing deployments keep running.
  // Read on the server and passed to the client as props, so a restart (not a
  // rebuild) applies a change. See lib/feature-flags.ts.
  FEATURE_OFFRAMP_ENABLED: featureSwitch,
  FEATURE_PAYROLL_ENABLED: featureSwitch,
  FEATURE_DEV_MODE_ENABLED: featureSwitch,
  FEATURE_AI_ASSISTANT_ENABLED: featureSwitch,
  FEATURE_ORACLE_CONDITION_ENABLED: featureSwitch,

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  // Network is pinned per environment: staging/dev = testnet, prod = mainnet.
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  // #808: operator-scoped, expiring testnet deployment recovery rehearsal.
  STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID: optionalUuid,
  STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL: optionalString.pipe(
    z.string().datetime({ offset: true }).optional(),
  ),
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
  STELLAR_WASM_HASH_TIMELOCK_BRANCH_TESTNET: optionalWasmHash,
  STELLAR_WASM_HASH_SPLITTER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_STREAMER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_CONDITIONAL_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_DEPOSIT_TRIGGER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_ROUTER_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_TIMELOCK_MAINNET: optionalWasmHash,
  STELLAR_WASM_HASH_TIMELOCK_BRANCH_MAINNET: optionalWasmHash,
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

  // ---- Soroswap ----
  // Router the swapper action calls. Soroswap redeploys its testnet router on
  // every reset, so this is config, not something stored on a flow graph.
  STELLAR_SOROSWAP_ROUTER_TESTNET: optionalContractAddress,
  STELLAR_SOROSWAP_ROUTER_MAINNET: optionalContractAddress,

  // Local event provisioning only; never set this on the Paiflow service.
  HACKATHON_ORGANISER_SECRET: optionalString,

  // ---- Relayer ----
  // Used for auto-releasing timelock contracts and for signing webhook
  // trigger transactions. Optional; when unset the admin address is used
  // as the relayer, disabling the relayer path.
  STELLAR_RELAYER_SECRET_KEY: optionalString,
  STELLAR_RELAYER_ADDRESS: optionalString,
  // Channel accounts derived from STELLAR_RELAYER_SECRET_KEY. Each channel is
  // the source and fee payer of relayer transactions so they can land in the
  // same ledger; the relayer key only signs the Soroban auth entries. 0 keeps
  // the relayer as its own source behind one lock. Capped so a typo cannot
  // ask for thousands of accounts to fund.
  STELLAR_RELAYER_CHANNELS: z.coerce.number().int().min(0).max(50).default(0),
  // Optional total envelope fee ceiling. Stellar transaction fees are uint32
  // stroops; preserve the exact integer string and reject ambiguous values.
  STELLAR_RELAYER_MAX_FEE_STROOPS: z
    .string()
    .refine((v) => /^[1-9]\d{0,9}$/.test(v) && BigInt(v) <= 4_294_967_295n, {
      message: "must be a positive canonical uint32 stroop string",
    })
    .optional(),

  // Paid TTL maintenance is opt-in; otherwise the cron only inventories.
  STELLAR_TTL_MAINTENANCE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  STELLAR_TTL_MAX_FEE_STROOPS: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .default("1000000"),
  STELLAR_TTL_FEE_BUDGET_NAME: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
    .optional(),
  STELLAR_TTL_FEE_BUDGET_STROOPS: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .optional(),

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

  // How many proxies in front of the app append to X-Forwarded-For; see
  // clientIp() in lib/rate-limit.ts. 0 = the edge replaces the header (Railway).
  // Invalid values make env() throw rather than guess: this decides which address
  // every per-IP limit sees.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  SENTRY_DSN: optionalString,

  // ---- Analytics (PostHog) ----
  // The key is public (it ships in the browser bundle) and is set only on the
  // beta service; unset means every capture is a no-op. APP_ENV tags events so
  // environments never mix in one PostHog project.
  NEXT_PUBLIC_POSTHOG_KEY: optionalString,
  NEXT_PUBLIC_APP_ENV: z.enum(["local", "staging", "beta"]).default("local"),
  POSTHOG_HOST: z
    .string()
    .url()
    .refine((u) => new URL(u).protocol === "https:", "POSTHOG_HOST must use https")
    .default("https://us.i.posthog.com"),
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

  // ---- Cron tuning ----
  PAYROLL_MAX_CATCHUP_PER_RUN: optionalPositiveInt(5),
  SUBSCRIPTION_MAX_CATCHUP_PER_RUN: optionalPositiveInt(5),
  OFFRAMP_BATCH_SIZE: optionalPositiveInt(50),
  OFFRAMP_MAX_RETRY_ATTEMPTS: optionalNonNegativeInt(3),
  OFFRAMP_JOB_LEASE_MS: optionalPositiveInt(600_000),
  OFFRAMP_JOB_CONCURRENCY: optionalPositiveInt(3),
  CONTRACT_READ_CACHE_ENABLED: boolishDefault(true),
  CONTRACT_READ_CACHE_TTL_SECONDS: optionalPositiveInt(300),

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

/** Every variable name EnvSchema knows about; tests/unit/setup.ts scrubs these. */
export const ENV_VAR_NAMES = EnvSchema.keyof().options;

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
  // Cross-field guard, not a schema .superRefine(): ENV_VAR_NAMES relies on
  // EnvSchema staying a ZodObject so `.keyof()` works.
  const rehearsalFlow = parsed.data.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID;
  const rehearsalUntil = parsed.data.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL;
  if (rehearsalFlow || rehearsalUntil) {
    if (parsed.data.STELLAR_NETWORK !== "testnet") {
      throw new Error("Deployment reconciliation rehearsal is testnet-only");
    }
    if (!rehearsalFlow || !rehearsalUntil) {
      throw new Error(
        "Deployment reconciliation rehearsal flow and expiry must be configured together",
      );
    }
    if (Date.parse(rehearsalUntil) > Date.now() + 60 * 60_000) {
      throw new Error("Deployment reconciliation rehearsal expiry must be at most one hour ahead");
    }
  }
  //
  // The sandbox mints a usable session for anyone who asks, with no account and
  // no credential. On mainnet that is an anonymous party pointing the builder at
  // real money, so the combination is refused outright rather than left to an
  // operator's memory. See CLAUDE.md §7.5 for the network model.
  if (parsed.data.SANDBOX_ENABLED && parsed.data.STELLAR_NETWORK === "mainnet") {
    throw new Error(
      "Invalid environment variables:\n" +
        "  - SANDBOX_ENABLED: cannot be true when STELLAR_NETWORK=mainnet. " +
        "The public sandbox is testnet-only.",
    );
  }

  // Same reasoning as the sandbox guard above: the demo endpoint hands a live
  // API credential to anyone who asks. On mainnet that is an anonymous party
  // holding a token against a real-money deployment, so it is refused outright.
  if (parsed.data.DEMO_API_ENABLED && parsed.data.STELLAR_NETWORK === "mainnet") {
    throw new Error(
      "Invalid environment variables:\n" +
        "  - DEMO_API_ENABLED: cannot be true when STELLAR_NETWORK=mainnet. " +
        "The public demo API is testnet-only.",
    );
  }
  // Enabled-but-unconfigured would only surface as a 500 on the first caller's
  // request, which reads as an outage rather than a missing setting.
  if (parsed.data.DEMO_API_ENABLED && !parsed.data.DEMO_API_DEPLOYMENT_ID) {
    throw new Error(
      "Invalid environment variables:\n" +
        "  - DEMO_API_DEPLOYMENT_ID: required when DEMO_API_ENABLED=true.",
    );
  }

  if (!!parsed.data.STELLAR_TTL_FEE_BUDGET_NAME !== !!parsed.data.STELLAR_TTL_FEE_BUDGET_STROOPS) {
    throw new Error("TTL fee budget name and limit must be configured together");
  }

  if (
    parsed.data.GOOGLE_AUTH_ENABLED &&
    (!parsed.data.GOOGLE_CLIENT_ID || !parsed.data.GOOGLE_CLIENT_SECRET)
  ) {
    throw new Error("Google authentication requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  }
  if (parsed.data.ALLOW_GOOGLE_REGISTRATION && !parsed.data.GOOGLE_AUTH_ENABLED) {
    throw new Error("Google registration requires GOOGLE_AUTH_ENABLED=true");
  }
  if (parsed.data.GOOGLE_AUTH_ENABLED) {
    const origin = new URL(parsed.data.AUTH_URL);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      (origin.protocol !== "https:" &&
        !(origin.protocol === "http:" && origin.hostname === "localhost"))
    ) {
      throw new Error(
        "Google authentication requires AUTH_URL to be an HTTPS origin (HTTP localhost allowed)",
      );
    }
  }
  cached = parsed.data;
  return cached;
}

/**
 * The deployment the public demo API hands tokens out for, or null when the
 * demo is off. The AND of flag and id lives here so no route can read the id
 * without the flag, and so a caller's reachable surface is one env lookup.
 */
export function demoApiDeploymentId(): string | null {
  const e = env();
  if (!e.DEMO_API_ENABLED) return null;
  return e.DEMO_API_DEPLOYMENT_ID ?? null;
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
    | "TIMELOCK_BRANCH"
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

export const SWAP_ROUTER_UNSET_MESSAGE =
  "Swap flows need the Soroswap router address. Set STELLAR_SOROSWAP_ROUTER_TESTNET (or _MAINNET) in the environment.";

export function soroswapRouterAddress(): string | undefined {
  const e = env();
  const suffix = e.STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
  const key = `STELLAR_SOROSWAP_ROUTER_${suffix}` as keyof EnvShape;
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

export function stellarRelayerChannelCount(): number {
  return env().STELLAR_RELAYER_CHANNELS;
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

/** Script-only config: no app database/auth configuration is needed. */
export function hackathonOrganiserSecret(): string {
  if (process.env.STELLAR_NETWORK !== "testnet")
    throw new Error("STELLAR_NETWORK must explicitly be testnet");
  const secret = process.env.HACKATHON_ORGANISER_SECRET;
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret))
    throw new Error("HACKATHON_ORGANISER_SECRET must be a valid testnet organiser key");
  return secret;
}
