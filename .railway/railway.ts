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

// This is a snapshot of the existing staging environment, not a provisioning
// template for production/testing. #529 must be reviewed before any apply.
const REGION = "asia-southeast1-eqsg3a";
const REPO = "webnxt-2030/pinkraft";
const STAGING_PROJECT_ID = "576ef2f5-16ec-4778-bdef-dca18f14d04b";
const STAGING_ENVIRONMENT_ID = "11e4c7d9-7b4c-43bd-ab93-50ff894bbb0b";

export default defineRailway((ctx) => {
  if (ctx.projectId !== STAGING_PROJECT_ID || ctx.environmentId !== STAGING_ENVIRONMENT_ID) {
    throw new Error("This configuration only describes paiflow/staging; refusing another target.");
  }
  // Retained evidence database: keep its endpoint and distinct volume unchanged.
  const postgresStagingArchive = postgres("postgres-staging-archive", {
    region: REGION,
  });
  postgresStagingArchive.networking = { privateNetworkEndpoint: "postgres" };
  // The live app DB is postgres-jgix; postgres belongs to the archive.
  const Postgres = postgres("Postgres", { region: REGION });
  Postgres.networking = { privateNetworkEndpoint: "postgres-jgix" };
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
  // Database helpers retain their existing mounts; these names preserve both volumes.
  const livePostgresVolume = volume("postgres-volume-_yQd", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: 50000,
  });
  const archivePostgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: 50000,
  });
  const paiflowApp = service("paiflow-app", {
    source: github(REPO, { branch: "staging", checkSuites: true }),
    // The importer omits NIXPACKS, but removing it produces an app redeploy.
    build: {
      builder: "NIXPACKS",
      buildCommand: "pnpm install --frozen-lockfile && pnpm db:generate && pnpm build",
    },
    deploy: {
      startCommand: "sh scripts/start-railway.sh",
      drainingSeconds: 30,
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 5,
    },
    replicas: { [REGION]: 1 },
    domains: ["beta.app.paiflow.xyz", "paiflow.xyz"],
    networking: { privateNetworkEndpoint: "pinkraft" },
    env: {
      ADMIN_SEED_PASSWORD: preserve(),
      ALLOW_GOOGLE_REGISTRATION: preserve(),
      ALLOW_PUBLIC_REGISTRATION: preserve(),
      AUTH_ORIGINS: preserve(),
      AUTH_RP_ID: preserve(),
      AUTH_RP_NAME: preserve(),
      AUTH_SECRET: preserve(),
      AUTH_URL: preserve(),
      CRON_SECRET: preserve(),
      DATABASE_URL: preserve(),
      DEMO_API_DEPLOYMENT_ID: preserve(),
      DEMO_API_ENABLED: preserve(),
      FEATURE_AI_ASSISTANT_ENABLED: preserve(),
      FEATURE_DEV_MODE_ENABLED: preserve(),
      FEATURE_OFFRAMP_ENABLED: preserve(),
      FEATURE_ORACLE_CONDITION_ENABLED: preserve(),
      FEATURE_PAYROLL_ENABLED: preserve(),
      FILE_STORAGE_DRIVER: preserve(),
      FILE_STORAGE_PATH: preserve(),
      GOOGLE_AUTH_ENABLED: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GROQ_API_KEY: preserve(),
      HIBP_CHECK_ENABLED: preserve(),
      LOG_LEVEL: preserve(),
      NEXT_PUBLIC_APP_ENV: preserve(),
      NEXT_PUBLIC_APP_URL: preserve(),
      NEXT_PUBLIC_POSTHOG_KEY: preserve(),
      NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: preserve(),
      NODE_ENV: preserve(),
      OFFRAMP_WEBHOOK_SECRET: preserve(),
      REDIS_URL: preserve(),
      SANDBOX_ENABLED: preserve(),
      STELLAR_NETWORK: preserve(),
      STELLAR_RELAYER_ADDRESS: preserve(),
      STELLAR_RELAYER_SECRET_KEY: preserve(),
      STELLAR_SOROSWAP_ROUTER_TESTNET: preserve(),
      STELLAR_TTL_MAINTENANCE_ENABLED: preserve(),
      STELLAR_WASM_HASH_SWAPPER_TESTNET: preserve(),
    },
  });
  const paiflowHomepage = service("paiflow-homepage", {
    source: github(REPO, {
      branch: "staging",
      checkSuites: false,
      rootDirectory: "/homepage",
    }),
    build: { buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["homepage/**"] },
    deploy: { healthcheckPath: "/", restartPolicyMaxRetries: 3 },
    replicas: { [REGION]: 1 },
    domains: ["beta.paiflow.xyz"],
  });

  return project("paiflow", {
    resources: [
      postgresStagingArchive,
      paiflowApp,
      Postgres,
      Redis,
      paiflowHomepage,
      redisVolume,
      livePostgresVolume,
      archivePostgresVolume,
    ],
  });
});
