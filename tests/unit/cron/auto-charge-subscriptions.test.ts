/**
 * #581, on the subscription side. The tenant chooses the relayer URL and
 * everything its endpoint answers, so this cron must refuse a non-public URL
 * before connecting, never follow a redirect, and never quote upstream text back
 * — here into the cron's own result payload and the logs rather than a DB column,
 * since subscriptions have no `PayrollRun` equivalent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChargeRelayerMode } from "@prisma/client";

const { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockUrlGuard } = vi.hoisted(() => {
  const mockDb = {
    deployment: { findMany: vi.fn(), update: vi.fn() },
  };

  const mockEnv = {
    CRON_SECRET: "cron-secret",
    STELLAR_NETWORK: "testnet",
    STELLAR_RELAYER_ADDRESS: "GDRELAYER" as string | undefined,
    SUBSCRIPTION_MAX_CATCHUP_PER_RUN: 5,
    CONTRACT_READ_CACHE_ENABLED: false,
    CONTRACT_READ_CACHE_TTL_SECONDS: 300,
  };

  const mockRelayer = {
    prepareSubscriptionChargeByRelayerTx: vi.fn(),
    submitSubscriptionChargeByRelayerTx: vi.fn(),
    readSubscriptionIsCancelled: vi.fn(),
    readSubscriptionNextChargeAt: vi.fn(),
    readSubscriptionAmountPerPeriod: vi.fn(),
    readSubscriptionSubscriber: vi.fn(),
    readSubscriptionAsset: vi.fn(),
    readSubscriptionRelayer: vi.fn(),
    readTokenAllowance: vi.fn(),
  };

  const mockInvoke = { prepareSubscriptionChargeByRelayerUnsigned: vi.fn() };
  const mockClient = {
    withRelayerLock: vi.fn((fn: () => unknown) => fn()),
    TENANT_RELAYER_TIMEOUT_MS: 25,
  };
  const mockUrlGuard = { assertPublicUrl: vi.fn() };

  return { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockUrlGuard };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  stellarRelayerAddress: () => mockEnv.STELLAR_RELAYER_ADDRESS,
  stellarPassphrase: () => "Test SDF Network ; September 2015",
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/stellar/relayer", () => mockRelayer);
vi.mock("@/lib/stellar/invoke", () => mockInvoke);
vi.mock("@/lib/stellar/client", () => mockClient);
// `importActual` keeps the real `UnsafeUrlError`, so `instanceof` in the route
// still holds when a case throws one.
vi.mock("@/lib/net/assert-public-url", async () => {
  const actual = await vi.importActual<typeof import("@/lib/net/assert-public-url")>(
    "@/lib/net/assert-public-url",
  );
  return { ...actual, assertPublicUrl: mockUrlGuard.assertPublicUrl };
});

import { UnsafeUrlError } from "@/lib/net/assert-public-url";
import { POST } from "@/app/api/cron/auto-charge-subscriptions/route";

function makeRequest(secret?: string) {
  return {
    headers: {
      get: (name: string) => (name === "x-cron-secret" ? (secret ?? null) : null),
    },
  } as unknown as import("next/server").NextRequest;
}

const now = new Date();
const duePast = Math.floor(now.getTime() / 1000) - 60;
const TX_HASH_OK = "b".repeat(64);

function primeUserDeployment(chargeRelayerUrl = "https://relayer.example.com/charge") {
  mockDb.deployment.findMany.mockResolvedValue([
    {
      id: "dep-sub",
      chargeEndAt: null,
      chargeRelayerMode: ChargeRelayerMode.USER,
      chargeRelayerAddress: "GTENANT",
      chargeRelayerUrl,
      chargeRelayerToken: "tenant-token",
      nextChargeAt: now,
      pipelineSnapshot: [{ nodeId: "sub", contractAddress: "C123", templateKind: "SUBSCRIPTION" }],
    },
  ]);
  mockRelayer.readSubscriptionIsCancelled.mockResolvedValue(false);
  // Due once, then satisfied, so a successful charge leaves the catch-up loop.
  mockRelayer.readSubscriptionNextChargeAt
    .mockResolvedValueOnce(BigInt(duePast))
    .mockResolvedValue(BigInt(duePast + 86_400));
  mockRelayer.readSubscriptionAmountPerPeriod.mockResolvedValue(1_000_000n);
  mockRelayer.readSubscriptionSubscriber.mockResolvedValue("GSUBSCRIBER");
  mockRelayer.readSubscriptionAsset.mockResolvedValue("CASSET");
  mockRelayer.readSubscriptionRelayer.mockResolvedValue("GTENANT");
  mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
  mockInvoke.prepareSubscriptionChargeByRelayerUnsigned.mockResolvedValue({ xdr: "unsigned-xdr" });
}

function stubFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn((_url: URL, _init: RequestInit) =>
    Promise.resolve(typeof response === "function" ? response() : response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("auto-charge-subscriptions tenant relayer guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.STELLAR_RELAYER_ADDRESS = "GDRELAYER";
    mockUrlGuard.assertPublicUrl.mockImplementation(async (raw: string) => new URL(raw));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("charges through the validated URL", async () => {
    primeUserDeployment();
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({ status: "SUCCESS", txHash: TX_HASH_OK }), { status: 200 }),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(mockUrlGuard.assertPublicUrl).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect(json.data.userCharged).toBe(1);
  });

  it("fails the charge and stops scheduling when the URL is refused for good", async () => {
    primeUserDeployment("https://redis.railway.internal/charge");
    const fetchMock = stubFetch(new Response("", { status: 200 }));
    mockUrlGuard.assertPublicUrl.mockRejectedValue(
      new UnsafeUrlError(
        "internal-name",
        '"redis.railway.internal" is a private or internal name',
        "Relayer URL",
        "chargeRelayerUrl",
      ),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(json.data.details[0]).toMatchObject({ status: "failed" });
    expect(json.data.skipped).toBe(0);
    expect(mockDb.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
      }),
    );
  });

  it("keeps the schedule when the refusal is only a DNS hiccup", async () => {
    primeUserDeployment();
    stubFetch(new Response("", { status: 200 }));
    mockUrlGuard.assertPublicUrl.mockRejectedValue(
      new UnsafeUrlError(
        "resolve-timeout",
        '"relayer.example.com" could not be resolved in time',
        "Relayer URL",
        "chargeRelayerUrl",
      ),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(json.data.details[0]).toMatchObject({ status: "failed" });
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });

  it("refuses a redirect instead of following it", async () => {
    primeUserDeployment();
    const fetchMock = stubFetch(
      new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(json.data.details[0]).toMatchObject({ status: "failed" });
    expect(JSON.stringify(json)).not.toContain("169.254");
  });

  it("never reports the upstream response body", async () => {
    primeUserDeployment();
    stubFetch(
      new Response("root:x:0:0:root:/root:/bin/bash\nSECRET_TOKEN=abc123", { status: 500 }),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(json.data.details[0]).toMatchObject({
      status: "failed",
      error: "User relayer returned 500",
    });
    expect(JSON.stringify(json)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(json)).not.toContain("root:x:0:0");
  });

  it("does not let a tenant payload reclassify the failure as an expected skip", async () => {
    primeUserDeployment();
    stubFetch(
      new Response(JSON.stringify({ status: "FAILED", errorMessage: "insufficient allowance" }), {
        status: 200,
      }),
    );

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(json.data.details[0]).toMatchObject({
      status: "failed",
      error: "User relayer did not return a success payload",
    });
    expect(json.data.skipped).toBe(0);
  });
});
