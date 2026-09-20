import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  redis,
  service,
  volume,
} from "railway/iac";

// Railway infrastructure-as-code. Replaces the repo-root railway.toml, which
// applied the Next.js build/start commands to *every* service in the repo —
// including the static homepage/ services, which then failed with
// "pnpm: command not found". Settings here are per-service.
//
// Preview: `railway config plan`   Apply: `railway config apply`

const REGION = "asia-southeast1-eqsg3a";
const REPO = "webnxt-2030/pinkraft";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: REGION });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };

  const Redis = redis("Redis", { region: REGION });
  Redis.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  };
  Redis.networking = { privateNetworkEndpoint: "redis" };

  const redisVolume = volume("redis-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: 50000,
  });
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: 50000,
  });

  // Next.js app (repo root). Build/start/healthcheck moved here from railway.toml.
  const paiflowApp = service("paiflow-app", {
    source: github(REPO, { branch: "staging", checkSuites: true }),
    build: {
      builder: "NIXPACKS",
      buildCommand: "pnpm install --frozen-lockfile && pnpm db:generate && pnpm build",
    },
    deploy: {
      startCommand: "pnpm db:migrate:deploy && pnpm start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 5,
    },
    replicas: { [REGION]: 1 },
    domains: ["beta.app.paiflow.xyz", "paiflow.xyz"],
    networking: { privateNetworkEndpoint: "pinkraft" },
    env: {
      ADMIN_SEED_PASSWORD: preserve(),
      ALLOW_PUBLIC_REGISTRATION: preserve(),
      // Passkey origins. Needed because this service answers on both
      // beta.app.paiflow.xyz and paiflow.xyz (see domains above) and WebAuthn
      // compares the origin exactly. Set this before removing AUTH_URL from the
      // service: next-auth rewrites every redirect to AUTH_URL's origin, which
      // is why the beta host bounces visitors to paiflow.xyz, but AUTH_URL is
      // also the passkey origin until AUTH_ORIGINS is in place.
      AUTH_ORIGINS: preserve(),
      AUTH_RP_ID: preserve(),
      AUTH_RP_NAME: preserve(),
      AUTH_SECRET: preserve(),
      AUTH_URL: preserve(),
      CRON_SECRET: preserve(),
      DATABASE_URL: preserve(),
      FILE_STORAGE_DRIVER: preserve(),
      FILE_STORAGE_PATH: preserve(),
      GROQ_API_KEY: preserve(),
      HIBP_CHECK_ENABLED: preserve(),
      LOG_LEVEL: preserve(),
      NEXT_PUBLIC_APP_URL: preserve(),
      NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: preserve(),
      NODE_ENV: preserve(),
      OFFRAMP_API_URL: preserve(),
      OFFRAMP_ASSET_CODE: preserve(),
      OFFRAMP_CHANNEL: preserve(),
      OFFRAMP_NETWORK: preserve(),
      OFFRAMP_PROVIDER: preserve(),
      OFFRAMP_REFRESH_TOKEN: preserve(),
      OFFRAMP_USERNAME: preserve(),
      OFFRAMP_WEBHOOK_SECRET: preserve(),
      REDIS_URL: preserve(),
      SANDBOX_ENABLED: preserve(),
      STELLAR_RELAYER_ADDRESS: preserve(),
      STELLAR_RELAYER_SECRET_KEY: preserve(),
      STELLAR_SOROSWAP_ROUTER_TESTNET: preserve(),
      STELLAR_WASM_HASH_SWAPPER_TESTNET: preserve(),
    },
  });

  // Static marketing site in homepage/ — Railpack auto-detects and serves it.
  const staticSite = (branch: string) => ({
    source: github(REPO, { branch, checkSuites: false, rootDirectory: "/homepage" }),
    build: {
      builder: "RAILPACK" as const,
      buildEnvironment: "V3" as const,
      watchPatterns: ["homepage/**"],
    },
    deploy: { healthcheckPath: "/", restartPolicyMaxRetries: 3 },
    replicas: { [REGION]: 1 },
  });

  const paiflowHomepage = service("paiflow-homepage", staticSite("staging"));
  const homepage = service("homepage", {
    ...staticSite("develop"),
    networking: { privateNetworkEndpoint: "pinkraft-3e58" },
  });

  return project("paiflow", {
    resources: [
      homepage,
      Postgres,
      paiflowApp,
      Redis,
      paiflowHomepage,
      redisVolume,
      postgresVolume,
    ],
  });
});
