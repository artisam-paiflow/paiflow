import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockDb, mockEnv } = vi.hoisted(() => {
  const mockDb = {
    offRampProviderCredential: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const mockEnv = {
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
    STELLAR_NETWORK_PASSPHRASE_MAINNET: "Public Global Stellar Network ; September 2015",
    STELLAR_HORIZON_URL_MAINNET: "https://horizon.stellar.org",
    STELLAR_SOROBAN_RPC_URL_MAINNET: "https://mainnet.sorobanrpc.com",
    STELLAR_FRIENDBOT_URL: "https://friendbot.stellar.org",
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
    OFFRAMP_PROVIDER: "pdax" as const,
    OFFRAMP_API_URL: "https://api.pdax.ph",
    OFFRAMP_ACCESS_TOKEN: undefined,
    OFFRAMP_REFRESH_TOKEN: undefined,
    OFFRAMP_USERNAME: undefined,
    OFFRAMP_ID_TOKEN: undefined,
    OFFRAMP_WEBHOOK_SECRET: undefined,
    OFFRAMP_ASSET_CODE: undefined,
    OFFRAMP_NETWORK: undefined,
    OFFRAMP_CHANNEL: undefined,
  };

  return { mockDb, mockEnv };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => mockEnv }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));

import {
  getPdaxAuthHeaders,
  refreshPdaxAccessToken,
  setPdaxCredential,
} from "@/lib/offramp/pdax-auth";

describe("pdax-auth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
    (mockEnv as any).OFFRAMP_REFRESH_TOKEN = undefined;
    (mockEnv as any).OFFRAMP_USERNAME = undefined;
    (mockEnv as any).OFFRAMP_ACCESS_TOKEN = undefined;
    (mockEnv as any).OFFRAMP_ID_TOKEN = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getPdaxAuthHeaders", () => {
    it("returns existing access token when not near expiry", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue({
        provider: "pdax",
        username: "test",
        accessToken: "access-123",
        idToken: "id-123",
        apiUrl: null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = await getPdaxAuthHeaders();

      expect(headers.Authorization).toBe("Bearer access-123");
      expect(headers.access_token).toBe("access-123");
      expect(headers.id_token).toBe("id-123");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("refreshes when token is within 2 minutes of expiry", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue({
        provider: "pdax",
        username: "test",
        accessToken: "access-123",
        idToken: "id-123",
        apiUrl: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "access-new",
          id_token: "id-new",
        }),
      });

      mockEnv.OFFRAMP_REFRESH_TOKEN = "refresh-123" as any;
      mockEnv.OFFRAMP_USERNAME = "test" as any;

      const headers = await getPdaxAuthHeaders();

      expect(headers.Authorization).toBe("Bearer access-new");
      expect(mockDb.offRampProviderCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ accessToken: "access-new" }),
          update: expect.objectContaining({ accessToken: "access-new" }),
        }),
      );
    });

    it("throws when no credentials are configured", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue(null);

      await expect(getPdaxAuthHeaders()).rejects.toThrow("PDAX credentials are not configured");
    });
  });

  describe("refreshPdaxAccessToken", () => {
    it("returns null when refresh token is missing", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue(null);
      mockEnv.OFFRAMP_USERNAME = "test" as any;

      const result = await refreshPdaxAccessToken();
      expect(result).toBeNull();
    });

    it("persists new tokens on successful refresh", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue({
        provider: "pdax",
        username: "test",
        accessToken: "access-123",
        idToken: "id-123",
        apiUrl: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "access-new",
          id_token: "id-new",
        }),
      });

      mockEnv.OFFRAMP_REFRESH_TOKEN = "refresh-123" as any;
      mockEnv.OFFRAMP_USERNAME = "test" as any;

      const result = await refreshPdaxAccessToken();

      expect(result).toEqual({ accessToken: "access-new", idToken: "id-new" });
      expect(mockDb.offRampProviderCredential.upsert).toHaveBeenCalled();
    });

    it("returns null when refresh request fails", async () => {
      mockDb.offRampProviderCredential.findUnique.mockResolvedValue({
        provider: "pdax",
        username: "test",
        accessToken: "access-123",
        idToken: "id-123",
        apiUrl: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(fetch as any).mockResolvedValue({
        ok: false,
        text: async () => "bad request",
      });

      mockEnv.OFFRAMP_REFRESH_TOKEN = "refresh-123" as any;
      mockEnv.OFFRAMP_USERNAME = "test" as any;

      const result = await refreshPdaxAccessToken();
      expect(result).toBeNull();
    });
  });

  describe("setPdaxCredential", () => {
    it("upserts credentials with a default expiry", async () => {
      await setPdaxCredential({
        username: "test",
        accessToken: "access-123",
        idToken: "id-123",
      });

      expect(mockDb.offRampProviderCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: "pdax" },
          create: expect.objectContaining({
            provider: "pdax",
            username: "test",
            accessToken: "access-123",
            idToken: "id-123",
          }),
          update: expect.objectContaining({
            username: "test",
            accessToken: "access-123",
            idToken: "id-123",
          }),
        }),
      );
    });
  });
});
