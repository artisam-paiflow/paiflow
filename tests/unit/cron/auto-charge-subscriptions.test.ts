// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
/**
 * #581, on the subscription side. The tenant chooses the relayer URL and
 * everything its endpoint answers, so this cron must refuse a non-public URL
 * before connecting, never follow a redirect, and never quote upstream text back
 * — here into the cron's own result payload and the logs rather than a DB column,
 * since subscriptions have no `PayrollRun` equivalent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChargeRelayerMode } from "@prisma/client";
import { observeExternalRelayer } from "@/lib/deployments/service-work";
import { log } from "@/lib/log";

const { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockUrlGuard } = vi.hoisted(() => {
  const mockDb = {
    deployment: { findMany: vi.fn(), updateMany: vi.fn() },
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
    readSubscriptionState: vi.fn(),
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
vi.mock("@/lib/stellar/subscription-state", () => ({
  createSubscriptionStateReader: () => mockRelayer.readSubscriptionState,
}));
vi.mock("@/lib/stellar/invoke", () => mockInvoke);
vi.mock("@/lib/stellar/client", () => mockClient);
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: (fn: (channel: unknown) => unknown) => fn({}),
}));
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
import { AppError } from "@/lib/errors";

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
      chargeScheduleRevision: 0,
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
    mockRelayer.readSubscriptionState.mockResolvedValue(null);
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

  // These are application-behavior tests: mocked fetch does not exercise
  // Undici's decoder, which may run before fetch returns on an unpatched runtime.
  it.each([undefined, "", "identity", "IDENTITY"])(
    "accepts response encoding %s and requests identity encoding",
    async (encoding) => {
      primeUserDeployment();
      const headers = new Headers();
      if (encoding !== undefined) headers.set("Content-Encoding", encoding);
      const fetchMock = stubFetch(
        new Response(JSON.stringify({ status: "SUCCESS", txHash: TX_HASH_OK }), {
          status: 200,
          headers,
        }),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1].headers);
      expect(requestHeaders.get("accept-encoding")).toBe("identity");
      expect(requestHeaders.get("content-type")).toBe("application/json");
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
      expect(json.data.userCharged).toBe(1);
      expect(json.data.failed).toBe(0);
    },
  );

  it.each([
    ["br", false],
    ["gzip", false],
    ["identity, gzip", false],
    ["insufficient-SECRET_HEADER", true],
  ])("rejects response encoding %s before parsing or submitting", async (encoding, cancelFails) => {
    primeUserDeployment();
    // A benign pending payload would reach submission if the encoding guard failed.
    const response = new Response(
      JSON.stringify({ status: "PENDING", signedXdr: "benign-placeholder", txHash: TX_HASH_OK }),
      { status: 200, headers: { "Content-Encoding": String(encoding) } },
    );
    const readJson = vi.spyOn(response, "json");
    const cancel = vi.spyOn(response.body!, "cancel");
    if (cancelFails) cancel.mockRejectedValue(new Error("SECRET_CANCEL_ERROR"));
    const fetchMock = stubFetch(response);

    const json = await (await POST(makeRequest("cron-secret"))).json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(readJson).not.toHaveBeenCalled();
    expect(mockRelayer.submitSubscriptionChargeByRelayerTx).not.toHaveBeenCalled();
    expect(observeExternalRelayer).not.toHaveBeenCalled();
    expect(json.data).toMatchObject({ userCharged: 0, failed: 1, skipped: 0 });
    expect(json.data.details[0]).toMatchObject({
      status: "failed",
      error: "User relayer returned an unsupported response encoding",
    });
    const reported = JSON.stringify(json) + JSON.stringify(vi.mocked(log.warn).mock.calls);
    expect(reported).not.toContain("SECRET_HEADER");
    expect(reported).not.toContain("SECRET_CANCEL_ERROR");
    expect(reported).not.toContain("benign-placeholder");
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
    expect(mockDb.deployment.updateMany).toHaveBeenCalledWith(
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
    expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
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

describe("auto-charge-subscriptions state preflight", () => {
  function prime(templateKind = "SUBSCRIPTION", combined = true) {
    primeUserDeployment();
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "dep-sub",
        chargeEndAt: null,
        chargeRelayerMode: ChargeRelayerMode.PLATFORM,
        chargeRelayerAddress: "GDRELAYER",
        nextChargeAt: now,
        chargeScheduleRevision: 0,
        pipelineSnapshot: [{ nodeId: "sub", contractAddress: "C123", templateKind }],
      },
    ]);
    mockRelayer.readSubscriptionRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.readSubscriptionState.mockResolvedValue(
      combined
        ? {
            isCancelled: false,
            nextChargeAt: BigInt(duePast),
            amountPerPeriod: "1000000",
            subscriber: "GSUBSCRIBER",
            asset: "CASSET",
            relayer: "GDRELAYER",
          }
        : null,
    );
    // The combined path does not consume the legacy preflight schedule read.
    if (combined)
      mockRelayer.readSubscriptionNextChargeAt
        .mockReset()
        .mockResolvedValue(BigInt(duePast + 86400));
    mockRelayer.prepareSubscriptionChargeByRelayerTx.mockResolvedValue({ xdr: "signed-fixture" });
    mockRelayer.submitSubscriptionChargeByRelayerTx.mockResolvedValue({ status: "SUCCESS" });
  }
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.STELLAR_RELAYER_ADDRESS = "GDRELAYER";
    mockEnv.CONTRACT_READ_CACHE_ENABLED = false;
  });
  it("charges standard subscriptions with the combined state and fresh allowance/post-charge schedule", async () => {
    prime();
    const json = await (await POST(makeRequest("cron-secret"))).json();
    expect(json.data.platformCharged).toBe(1);
    for (const name of [
      "readSubscriptionIsCancelled",
      "readSubscriptionAmountPerPeriod",
      "readSubscriptionSubscriber",
      "readSubscriptionAsset",
      "readSubscriptionRelayer",
    ] as const)
      expect(mockRelayer[name]).not.toHaveBeenCalled();
    expect(mockRelayer.readSubscriptionState).toHaveBeenCalledWith("C123");
    expect(mockRelayer.readTokenAllowance).toHaveBeenCalledWith({
      tokenContractAddress: "CASSET",
      owner: "GSUBSCRIBER",
      spender: "C123",
    });
    expect(mockRelayer.readSubscriptionNextChargeAt).toHaveBeenCalledTimes(2);
    expect(mockDb.deployment.updateMany).toHaveBeenCalledWith({
      where: { id: "dep-sub", serviceState: "ACTIVE", chargeScheduleRevision: 0 },
      data: { nextChargeAt: new Date((duePast + 86400) * 1000) },
    });
  });
  it.each(["SUBSCRIPTION", "SUBSCRIPTION_DEV"])(
    "keeps %s legacy reads functional",
    async (kind) => {
      prime(kind, false);
      const json = await (await POST(makeRequest("cron-secret"))).json();
      expect(json.data.platformCharged).toBe(1);
      expect(mockRelayer.readSubscriptionAmountPerPeriod).toHaveBeenCalledTimes(1);
      expect(mockRelayer.readSubscriptionSubscriber).toHaveBeenCalledTimes(1);
      expect(mockRelayer.readSubscriptionNextChargeAt).toHaveBeenCalledTimes(3);
      if (kind === "SUBSCRIPTION_DEV")
        expect(mockRelayer.readSubscriptionState).not.toHaveBeenCalled();
    },
  );
  it("reads Dev amount and subscriber fresh even with immutable cache enabled", async () => {
    prime("SUBSCRIPTION_DEV", false);
    mockEnv.CONTRACT_READ_CACHE_ENABLED = true;
    const rows = await mockDb.deployment.findMany();
    mockDb.deployment.findMany.mockResolvedValue([...rows, { ...rows[0], id: "dep-sub-2" }]);
    mockRelayer.readSubscriptionNextChargeAt
      .mockReset()
      .mockResolvedValueOnce(BigInt(duePast))
      .mockResolvedValueOnce(BigInt(duePast + 86400))
      .mockResolvedValueOnce(BigInt(duePast + 86400))
      .mockResolvedValueOnce(BigInt(duePast))
      .mockResolvedValue(BigInt(duePast + 86400));
    const json = await (await POST(makeRequest("cron-secret"))).json();
    expect(json.data.platformCharged).toBe(2);
    expect(mockRelayer.readSubscriptionAmountPerPeriod).toHaveBeenCalledTimes(2);
    expect(mockRelayer.readSubscriptionSubscriber).toHaveBeenCalledTimes(2);
    expect(mockRelayer.readSubscriptionAsset).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "expired", "not-due", "allowance", "relayer", "invalid-date"])(
    "preserves %s outcome without signing",
    async (scenario) => {
      prime();
      const state = await mockRelayer.readSubscriptionState();
      mockRelayer.readSubscriptionState.mockClear();
      if (scenario === "cancelled") state.isCancelled = true;
      if (scenario === "not-due") state.nextChargeAt = BigInt(duePast + 86400);
      if (scenario === "invalid-date") state.nextChargeAt = (1n << 64n) - 1n;
      if (scenario === "relayer") state.relayer = "GROTATED";
      if (scenario === "allowance") mockRelayer.readTokenAllowance.mockResolvedValue(0n);
      if (scenario === "expired") {
        const rows = await mockDb.deployment.findMany();
        rows[0].chargeEndAt = new Date(0);
      }
      const json = await (await POST(makeRequest("cron-secret"))).json();
      expect(json.data[scenario === "invalid-date" ? "failed" : "skipped"]).toBe(1);
      expect(mockRelayer.prepareSubscriptionChargeByRelayerTx).not.toHaveBeenCalled();
      if (["cancelled", "expired", "not-due", "invalid-date"].includes(scenario))
        expect(mockRelayer.readTokenAllowance).not.toHaveBeenCalled();
      if (["cancelled", "expired"].includes(scenario))
        expect(mockDb.deployment.updateMany).toHaveBeenCalledWith({
          where: { id: "dep-sub", serviceState: "ACTIVE", chargeScheduleRevision: 0 },
          data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
        });
      if (scenario === "invalid-date") expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
    },
  );
  it("reports state RPC failure without falling back or changing scheduling", async () => {
    prime();
    mockRelayer.readSubscriptionState.mockRejectedValue(
      new AppError("UPSTREAM_RPC", "Subscription state simulation failed"),
    );
    const json = await (await POST(makeRequest("cron-secret"))).json();
    expect(json.data.failed).toBe(1);
    expect(mockRelayer.readSubscriptionIsCancelled).not.toHaveBeenCalled();
    expect(mockRelayer.prepareSubscriptionChargeByRelayerTx).not.toHaveBeenCalled();
    expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
  });
  it("keeps failed charges due and reads fresh next-charge time for catch-up", async () => {
    prime();
    mockRelayer.submitSubscriptionChargeByRelayerTx.mockResolvedValue({
      status: "FAILED",
      errorMessage: "network failure",
    });
    const failed = await (await POST(makeRequest("cron-secret"))).json();
    expect(failed.data.failed).toBe(1);
    expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
    expect(mockRelayer.readSubscriptionNextChargeAt).not.toHaveBeenCalled();
    prime();
    mockRelayer.readSubscriptionNextChargeAt
      .mockReset()
      .mockResolvedValueOnce(BigInt(duePast))
      .mockResolvedValue(BigInt(duePast + 86400));
    const success = await (await POST(makeRequest("cron-secret"))).json();
    expect(success.data.platformCharged).toBe(2);
    expect(mockRelayer.readSubscriptionState).toHaveBeenCalledTimes(2); // once in each cron run
    expect(mockRelayer.readSubscriptionNextChargeAt).toHaveBeenCalledTimes(3);
  });
  it.each([1, 2])(
    "retains confirmed counts when post-charge schedule read %i fails",
    async (read) => {
      prime();
      if (read === 2)
        mockRelayer.readSubscriptionNextChargeAt.mockResolvedValueOnce(BigInt(duePast + 86400));
      mockRelayer.readSubscriptionNextChargeAt.mockRejectedValueOnce(new Error("RPC unavailable"));
      const result = await (await POST(makeRequest("cron-secret"))).json();
      expect(result.data.platformCharged).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.details[0]).toMatchObject({
        status: "charged",
        chargedCount: 1,
        error: expect.any(String),
      });
      expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
      expect(mockRelayer.submitSubscriptionChargeByRelayerTx).toHaveBeenCalledTimes(1);
    },
  );
  it("retains earlier confirmed charges when a later catch-up charge fails", async () => {
    prime();
    mockRelayer.readSubscriptionNextChargeAt.mockResolvedValue(BigInt(duePast));
    mockRelayer.submitSubscriptionChargeByRelayerTx
      .mockResolvedValueOnce({ status: "SUCCESS", txHash: TX_HASH_OK })
      .mockResolvedValueOnce({
        status: "FAILED",
        txHash: "c".repeat(64),
        errorMessage: "network failure",
      });
    const result = await (await POST(makeRequest("cron-secret"))).json();
    expect(result.data.platformCharged).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.details[0]).toMatchObject({
      status: "charged",
      chargedCount: 1,
      error: expect.any(String),
    });
    expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
  });
  it("keeps confirmed counts separate from a failed database schedule checkpoint", async () => {
    prime();
    mockDb.deployment.updateMany.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await (await POST(makeRequest("cron-secret"))).json();
    expect(result.data.platformCharged).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.details[0]).toMatchObject({
      status: "charged",
      chargedCount: 1,
      error: expect.any(String),
    });
    expect(mockDb.deployment.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "dep-sub", serviceState: "ACTIVE", chargeScheduleRevision: 0 },
      data: { nextChargeAt: new Date((duePast + 86400) * 1000) },
    });
  });
  it("never invents charge history or resubmits when a later tick observes an advanced schedule after unknown finality", async () => {
    prime();
    mockRelayer.submitSubscriptionChargeByRelayerTx.mockResolvedValue({
      status: "FAILED",
      txHash: TX_HASH_OK,
      errorMessage: "Timed out waiting for finality",
    });
    const first = await (await POST(makeRequest("cron-secret"))).json();
    expect(first.data.platformCharged).toBe(0);
    expect(mockDb.deployment.updateMany).not.toHaveBeenCalled();
    const state = await mockRelayer.readSubscriptionState();
    state.nextChargeAt = BigInt(duePast + 86400);
    await POST(makeRequest("cron-secret"));
    expect(mockRelayer.submitSubscriptionChargeByRelayerTx).toHaveBeenCalledTimes(1);
    expect(mockDb.deployment.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "dep-sub", serviceState: "ACTIVE", chargeScheduleRevision: 0 },
      data: { nextChargeAt: new Date((duePast + 86400) * 1000) },
    });
  });
});
