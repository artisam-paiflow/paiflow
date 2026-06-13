type StellarNetworkName = "testnet" | "mainnet";

type EnvShape = {
  NODE_ENV: "test";
  NEXT_PUBLIC_APP_URL: string;
  LOG_LEVEL: "silent";
  AUTH_SECRET: string;
  AUTH_URL: string;
  AUTH_RP_ID: string;
  AUTH_RP_NAME: string;
  ALLOW_PUBLIC_REGISTRATION: boolean;
  DATABASE_URL: string;
  REDIS_URL: string | undefined;
  STELLAR_NETWORK: StellarNetworkName;
  STELLAR_NETWORK_PASSPHRASE_TESTNET: string;
  STELLAR_HORIZON_URL_TESTNET: string;
  STELLAR_SOROBAN_RPC_URL_TESTNET: string;
  STELLAR_NETWORK_PASSPHRASE_MAINNET: string;
  STELLAR_HORIZON_URL_MAINNET: string;
  STELLAR_SOROBAN_RPC_URL_MAINNET: string;
  STELLAR_FRIENDBOT_URL: string | undefined;
  STELLAR_WASM_HASH_SPLITTER_TESTNET: string | undefined;
  STELLAR_WASM_HASH_STREAMER_TESTNET: string | undefined;
  STELLAR_WASM_HASH_CONDITIONAL_TESTNET: string | undefined;
  STELLAR_WASM_HASH_DEPOSIT_TRIGGER_TESTNET: string | undefined;
  STELLAR_WASM_HASH_ROUTER_TESTNET: string | undefined;
  STELLAR_WASM_HASH_TIMELOCK_TESTNET: string | undefined;
  STELLAR_WASM_HASH_SPLITTER_MAINNET: string | undefined;
  STELLAR_WASM_HASH_STREAMER_MAINNET: string | undefined;
  STELLAR_WASM_HASH_CONDITIONAL_MAINNET: string | undefined;
  STELLAR_WASM_HASH_DEPOSIT_TRIGGER_MAINNET: string | undefined;
  STELLAR_WASM_HASH_ROUTER_MAINNET: string | undefined;
  STELLAR_WASM_HASH_TIMELOCK_MAINNET: string | undefined;
  CRON_SECRET: string | undefined;
  SENTRY_DSN: string | undefined;
  HIBP_CHECK_ENABLED: boolean;
  AI_API_KEY: string | undefined;
  AI_BASE_URL: string | undefined;
  AI_MODEL: string | undefined;
  GROQ_API_KEY: string | undefined;
  GROQ_MODEL: string | undefined;
};

let active: StellarNetworkName = "testnet";

export function setStubNetwork(network: StellarNetworkName) {
  active = network;
}

function build(): EnvShape {
  return {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    LOG_LEVEL: "silent",
    AUTH_SECRET: "test_auth_secret_at_least_32_chars_long",
    AUTH_URL: "http://localhost:3000",
    AUTH_RP_ID: "localhost",
    AUTH_RP_NAME: "Pink Raft",
    ALLOW_PUBLIC_REGISTRATION: false,
    DATABASE_URL: "postgresql://localhost:5432/pinkraft",
    REDIS_URL: undefined,
    STELLAR_NETWORK: active,
    STELLAR_NETWORK_PASSPHRASE_TESTNET: "Test SDF Network ; September 2015",
    STELLAR_HORIZON_URL_TESTNET: "https://horizon-testnet.stellar.org",
    STELLAR_SOROBAN_RPC_URL_TESTNET: "https://soroban-testnet.stellar.org",
    STELLAR_NETWORK_PASSPHRASE_MAINNET: "Public Global Stellar Network ; September 2015",
    STELLAR_HORIZON_URL_MAINNET: "https://horizon.stellar.org",
    STELLAR_SOROBAN_RPC_URL_MAINNET: "https://mainnet.sorobanrpc.com",
    STELLAR_FRIENDBOT_URL: active === "testnet" ? "https://friendbot.stellar.org" : undefined,
    STELLAR_WASM_HASH_SPLITTER_TESTNET: undefined,
    STELLAR_WASM_HASH_STREAMER_TESTNET: undefined,
    STELLAR_WASM_HASH_CONDITIONAL_TESTNET: undefined,
    STELLAR_WASM_HASH_DEPOSIT_TRIGGER_TESTNET: undefined,
    STELLAR_WASM_HASH_ROUTER_TESTNET: undefined,
    STELLAR_WASM_HASH_TIMELOCK_TESTNET: undefined,
    STELLAR_WASM_HASH_SPLITTER_MAINNET: undefined,
    STELLAR_WASM_HASH_STREAMER_MAINNET: undefined,
    STELLAR_WASM_HASH_CONDITIONAL_MAINNET: undefined,
    STELLAR_WASM_HASH_DEPOSIT_TRIGGER_MAINNET: undefined,
    STELLAR_WASM_HASH_ROUTER_MAINNET: undefined,
    STELLAR_WASM_HASH_TIMELOCK_MAINNET: undefined,
    CRON_SECRET: undefined,
    SENTRY_DSN: undefined,
    HIBP_CHECK_ENABLED: false,
    AI_API_KEY: undefined,
    AI_BASE_URL: undefined,
    AI_MODEL: undefined,
    GROQ_API_KEY: undefined,
    GROQ_MODEL: undefined,
  };
}

export const env = () => build();

function assertActive(network: StellarNetworkName) {
  if (active !== network) {
    throw new Error(
      `Stellar network mismatch: requested ${network} but STELLAR_NETWORK=${active}.`,
    );
  }
}

export function stellarPassphrase(network?: StellarNetworkName) {
  if (network) assertActive(network);
  return active === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}

export function stellarRpcUrl(network?: StellarNetworkName) {
  if (network) assertActive(network);
  return active === "mainnet"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org";
}

export function stellarHorizonUrl(network?: StellarNetworkName) {
  if (network) assertActive(network);
  return active === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}
