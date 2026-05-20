export const env = () => ({
  NODE_ENV: "test" as const,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  LOG_LEVEL: "silent" as const,
  AUTH_SECRET: "test_auth_secret_at_least_32_chars_long",
  AUTH_URL: "http://localhost:3000",
  AUTH_RP_ID: "localhost",
  AUTH_RP_NAME: "Pink Raft",
  ALLOW_PUBLIC_REGISTRATION: false,
  DATABASE_URL: "postgresql://localhost:5432/pinkraft",
  REDIS_URL: undefined,
  STELLAR_NETWORK: "testnet" as const,
  STELLAR_NETWORK_PASSPHRASE_TESTNET: "Test SDF Network ; September 2015",
  STELLAR_HORIZON_URL_TESTNET: "https://horizon-testnet.stellar.org",
  STELLAR_SOROBAN_RPC_URL_TESTNET: "https://soroban-testnet.stellar.org",
  STELLAR_FRIENDBOT_URL: "https://friendbot.stellar.org",
  ENABLE_MAINNET: false,
  STELLAR_WASM_HASH_SPLITTER: undefined,
  STELLAR_WASM_HASH_STREAMER: undefined,
  STELLAR_WASM_HASH_CONDITIONAL: undefined,
  CRON_SECRET: undefined,
  SENTRY_DSN: undefined,
  HIBP_CHECK_ENABLED: false,
  AI_API_KEY: undefined,
  AI_BASE_URL: undefined,
  AI_MODEL: undefined,
  GROQ_API_KEY: undefined,
  GROQ_MODEL: undefined,
});

export function stellarPassphrase() {
  return "Test SDF Network ; September 2015";
}

export function stellarRpcUrl() {
  return "https://soroban-testnet.stellar.org";
}

export function stellarHorizonUrl() {
  return "https://horizon-testnet.stellar.org";
}
