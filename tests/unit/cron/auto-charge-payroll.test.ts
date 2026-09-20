import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChargeRelayerMode, PayrollRunStatus } from "@prisma/client";

const { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockJobs, mockUrlGuard } = vi.hoisted(
  () => {
    const mockDb = {
      deployment: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      payrollRun: {
        create: vi.fn(),
        update: vi.fn(),
      },
      employee: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      payrollPayout: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb: any) => cb(mockDb)),
    };

    const mockEnv = {
      CRON_SECRET: "cron-secret",
      STELLAR_NETWORK: "testnet",
      STELLAR_RELAYER_ADDRESS: "GDRELAYER" as string | undefined,
      PAYROLL_MAX_CATCHUP_PER_RUN: 5,
      CONTRACT_READ_CACHE_ENABLED: true,
      CONTRACT_READ_CACHE_TTL_SECONDS: 300,
    };

    const mockRelayer = {
      preparePayrollChargeByRelayerTx: vi.fn(),
      submitPayrollChargeByRelayerTx: vi.fn(),
      readPayrollIsCancelled: vi.fn(),
      readPayrollNextChargeAt: vi.fn(),
      readPayrollEmployer: vi.fn(),
      readPayrollAsset: vi.fn(),
      readPayrollRecipients: vi.fn(),
      readPayrollRelayer: vi.fn(),
      readTokenAllowance: vi.fn(),
      prepareSubscriptionChargeByRelayerTx: vi.fn(),
      submitSubscriptionChargeByRelayerTx: vi.fn(),
      readSubscriptionIsCancelled: vi.fn(),
      readSubscriptionNextChargeAt: vi.fn(),
      readSubscriptionAmountPerPeriod: vi.fn(),
      readSubscriptionSubscriberNullable: vi.fn(),
      readSubscriptionAsset: vi.fn(),
      readSubscriptionRelayer: vi.fn(),
      readSplitterDevRecipients: vi.fn(),
    };

    const mockInvoke = {
      preparePayrollChargeByRelayerUnsigned: vi.fn(),
    };

    const mockClient = {
      withRelayerLock: vi.fn((fn: any) => fn()),
      TENANT_RELAYER_TIMEOUT_MS: 25,
    };

    const mockJobs = {
      createOffRampJobsForPayrollRun: vi.fn(),
    };

    const mockUrlGuard = { assertPublicUrl: vi.fn() };

    return { mockDb, mockEnv, mockRelayer, mockInvoke, mockClient, mockJobs, mockUrlGuard };
  },
);

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
vi.mock("@/lib/offramp/jobs", () => mockJobs);
// The guard resolves DNS for real, and these fixtures use reserved `.example`
// hostnames that never resolve. `importActual` keeps the real `UnsafeUrlError`,
// so `instanceof` in the route still holds when a case throws one.
vi.mock("@/lib/net/assert-public-url", async () => {
  const actual = await vi.importActual<typeof import("@/lib/net/assert-public-url")>(
    "@/lib/net/assert-public-url",
  );
  return { ...actual, assertPublicUrl: mockUrlGuard.assertPublicUrl };
});

import { UnsafeUrlError } from "@/lib/net/assert-public-url";
import { POST } from "@/app/api/cron/auto-charge-payroll/route";

function makeRequest(secret?: string) {
  return {
    headers: {
      get: (name: string) => (name === "x-cron-secret" ? (secret ?? null) : null),
    },
  } as unknown as import("next/server").NextRequest;
}

const now = new Date();
const nextChargeAt = Math.floor(now.getTime() / 1000) - 60;
/** A tenant relayer's `txHash` is persisted and rendered into a link, so the
 * route now holds the response to the shape of a real hash. */
const TX_HASH_OK = "a".repeat(64);

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status: "CONFIRMED",
    flow: { templateKind: "PAYROLL" },
    pipelineSnapshot: [{ nodeId: "payroll", contractAddress: "C123", templateKind: "PAYROLL" }],
    chargeRelayerMode: ChargeRelayerMode.PLATFORM,
    chargeRelayerUrl: null,
    chargeRelayerToken: null,
    chargeRelayerAddress: null,
    nextChargeAt: now,
    chargeEndAt: null,
    lastChargedAt: null,
    offRampEnabled: false,
    ...overrides,
  };
}

describe("auto-charge-payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.STELLAR_RELAYER_ADDRESS = "GDRELAYER";
    mockUrlGuard.assertPublicUrl.mockImplementation(async (raw: string) => new URL(raw));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects requests without the cron secret", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(403);
  });

  it("skips when relayer address is not configured", async () => {
    mockEnv.STELLAR_RELAYER_ADDRESS = undefined;

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.notice).toContain("STELLAR_RELAYER_ADDRESS is not configured");
  });

  it("charges a platform payroll and creates run + payouts", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment()]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([
      { address: "GEMP1", amount: "5000000" },
      { address: "GEMP2", amount: "5000000" },
    ]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-1",
    });
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.findMany.mockResolvedValue([]);
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.platformCharged).toBe(1);
    expect(mockDb.payrollRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PayrollRunStatus.PENDING }),
      }),
    );
    expect(mockDb.employee.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.payrollPayout.create).toHaveBeenCalledTimes(2);
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: PayrollRunStatus.CHARGED, txHash: "tx-1" }),
      }),
    );
  });

  it("marks the run as FAILED when the charge fails", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment()]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "FAILED",
      errorMessage: "Simulation failed",
    });
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.findMany.mockResolvedValue([]);

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.failed).toBe(1);
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: PayrollRunStatus.FAILED }),
      }),
    );
  });

  it("creates off-ramp jobs for non-dev payroll when a fiat employee has bank details", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment({ offRampEnabled: false })]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-1",
    });
    mockDb.employee.findMany.mockResolvedValue([
      {
        id: "emp-1",
        address: "GEMP1",
        payoutMode: "FIAT",
        cashOutContractAddress: null,
        bankDetail: { accountName: "A", accountNumber: "123", bankCode: "B" },
      },
    ]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockResolvedValue(["job-1"]);

    const res = await POST(makeRequest("cron-secret"));
    await res.json();

    expect(mockJobs.createOffRampJobsForPayrollRun).toHaveBeenCalledWith(mockDb, "run-1");
  });

  it("does not create off-ramp jobs when no fiat employee has bank details", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment({ offRampEnabled: false })]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GDRELAYER");
    mockRelayer.preparePayrollChargeByRelayerTx.mockResolvedValue({ xdr: "xdr-1" });
    mockRelayer.submitPayrollChargeByRelayerTx.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-1",
    });
    mockDb.employee.findMany.mockResolvedValue([
      {
        id: "emp-1",
        address: "GEMP1",
        payoutMode: "CRYPTO",
        cashOutContractAddress: null,
        bankDetail: null,
      },
    ]);
    mockDb.payrollRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
    mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    mockJobs.createOffRampJobsForPayrollRun.mockResolvedValue(["job-1"]);

    const res = await POST(makeRequest("cron-secret"));
    await res.json();

    expect(mockJobs.createOffRampJobsForPayrollRun).not.toHaveBeenCalled();
  });

  it("fails a USER deployment whose relayer never answers and carries on to the next", async () => {
    const user = {
      chargeRelayerMode: ChargeRelayerMode.USER,
      chargeRelayerAddress: "GTENANT",
    };
    mockDb.deployment.findMany.mockResolvedValue([
      makeDeployment({ id: "dep-hung", chargeRelayerUrl: "https://hung.example/charge", ...user }),
      makeDeployment({ id: "dep-ok", chargeRelayerUrl: "https://ok.example/charge", ...user }),
    ]);
    mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
    mockRelayer.readPayrollNextChargeAt
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValueOnce(BigInt(nextChargeAt))
      .mockResolvedValue(BigInt(nextChargeAt + 86400));
    mockRelayer.readPayrollRecipients.mockResolvedValue([{ address: "GEMP1", amount: "5000000" }]);
    mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
    mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
    mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
    mockRelayer.readPayrollRelayer.mockResolvedValue("GTENANT");
    mockInvoke.preparePayrollChargeByRelayerUnsigned.mockResolvedValue({ xdr: "unsigned-xdr" });
    mockDb.payrollRun.create
      .mockResolvedValueOnce({ id: "run-hung" })
      .mockResolvedValueOnce({ id: "run-ok" });
    mockDb.employee.findMany.mockResolvedValue([]);
    mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });

    // The route fetches the validated `URL`, not the raw string.
    const fetchMock = vi.fn((url: URL, init: RequestInit) => {
      if (String(url).includes("hung")) {
        // Never answers; settles only when the caller's own signal gives up.
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "SUCCESS", txHash: TX_HASH_OK }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(json.data.failed).toBe(1);
    expect(json.data.userCharged).toBe(1);
    expect(json.data.details).toEqual([
      expect.objectContaining({ deploymentId: "dep-hung", status: "failed" }),
      expect.objectContaining({ deploymentId: "dep-ok", status: "charged" }),
    ]);
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-hung" },
        data: expect.objectContaining({ status: PayrollRunStatus.FAILED }),
      }),
    );
    expect(mockDb.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-ok" },
        data: expect.objectContaining({ status: PayrollRunStatus.CHARGED, txHash: TX_HASH_OK }),
      }),
    );
  });

  it("skips when no chargeable contract is in the pipeline", async () => {
    mockDb.deployment.findMany.mockResolvedValue([makeDeployment({ pipelineSnapshot: [] })]);

    const res = await POST(makeRequest("cron-secret"));
    const json = await res.json();

    expect(json.data.skipped).toBe(1);
  });

  /**
   * #581. The tenant chooses the relayer URL and everything its endpoint
   * answers, and `PayrollRun.lastError` is read back by the owner, so the cron
   * must (a) refuse a non-public URL before connecting, (b) never follow a
   * redirect, (c) never persist upstream text, and (d) never let the tenant's
   * answer decide how the failure is classified.
   */
  describe("tenant relayer SSRF guards", () => {
    function primeUserDeployment(overrides: Record<string, unknown> = {}) {
      mockDb.deployment.findMany.mockResolvedValue([
        makeDeployment({
          id: "dep-user",
          chargeRelayerMode: ChargeRelayerMode.USER,
          chargeRelayerAddress: "GTENANT",
          chargeRelayerUrl: "https://relayer.example.com/charge",
          ...overrides,
        }),
      ]);
      mockRelayer.readPayrollIsCancelled.mockResolvedValue(false);
      // Due once, then satisfied, so a successful charge leaves the catch-up
      // loop after a single iteration.
      mockRelayer.readPayrollNextChargeAt
        .mockResolvedValueOnce(BigInt(nextChargeAt))
        .mockResolvedValue(BigInt(nextChargeAt + 86_400));
      mockRelayer.readPayrollRecipients.mockResolvedValue([
        { address: "GEMP1", amount: "5000000" },
      ]);
      mockRelayer.readPayrollEmployer.mockResolvedValue("GEMPLOYER");
      mockRelayer.readPayrollAsset.mockResolvedValue("CASSET");
      mockRelayer.readTokenAllowance.mockResolvedValue(10_000_000n);
      mockRelayer.readPayrollRelayer.mockResolvedValue("GTENANT");
      mockInvoke.preparePayrollChargeByRelayerUnsigned.mockResolvedValue({ xdr: "unsigned-xdr" });
      mockDb.payrollRun.create.mockResolvedValue({ id: "run-user" });
      mockDb.employee.findMany.mockResolvedValue([]);
      mockDb.employee.upsert.mockResolvedValue({ id: "emp-1" });
      mockDb.payrollPayout.create.mockResolvedValue({ id: "payout-1" });
    }

    function stubFetch(response: Response | (() => Response)) {
      const fetchMock = vi.fn((_url: URL, _init: RequestInit) =>
        Promise.resolve(typeof response === "function" ? response() : response),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function lastErrorOf(): string {
      type UpdateArg = { data?: { lastError?: string } };
      const call = mockDb.payrollRun.update.mock.calls.find(
        (c: unknown[]) => (c[0] as UpdateArg | undefined)?.data?.lastError !== undefined,
      );
      return (call?.[0] as { data: { lastError: string } }).data.lastError;
    }

    it("checks the stored URL once per deployment, before connecting", async () => {
      primeUserDeployment();
      // A fresh Response per call: a body can only be read once.
      const fetchMock = stubFetch(
        () =>
          new Response(JSON.stringify({ status: "SUCCESS", txHash: TX_HASH_OK }), { status: 200 }),
      );

      await POST(makeRequest("cron-secret"));

      expect(mockUrlGuard.assertPublicUrl).toHaveBeenCalledWith(
        "https://relayer.example.com/charge",
        expect.objectContaining({ field: "chargeRelayerUrl" }),
      );
      expect(mockUrlGuard.assertPublicUrl).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The validated URL is what gets fetched, not the raw column value.
      expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    });

    it("fails the run and stops scheduling when the URL is refused for good", async () => {
      primeUserDeployment({ chargeRelayerUrl: "https://redis.railway.internal/charge" });
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
      expect(lastErrorOf()).toContain("private or internal name");
      expect(mockDb.deployment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
        }),
      );
      expect(json.data.details[0]).toMatchObject({ status: "failed" });
      expect(json.data.skipped).toBe(0);
    });

    it("keeps the schedule when the refusal is only a DNS hiccup", async () => {
      primeUserDeployment();
      stubFetch(new Response("", { status: 200 }));
      mockUrlGuard.assertPublicUrl.mockRejectedValue(
        new UnsafeUrlError(
          "unresolvable",
          '"relayer.example.com" could not be resolved',
          "Relayer URL",
          "chargeRelayerUrl",
        ),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(json.data.details[0]).toMatchObject({ status: "failed" });
      expect(mockDb.deployment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ chargeRelayerMode: ChargeRelayerMode.MANUAL }),
        }),
      );
    });

    it("does not let a refusal mentioning 'insufficient' become an expected skip", async () => {
      primeUserDeployment({ chargeRelayerUrl: "https://insufficient.internal/charge" });
      stubFetch(new Response("", { status: 200 }));
      mockUrlGuard.assertPublicUrl.mockRejectedValue(
        new UnsafeUrlError(
          "internal-name",
          '"insufficient.internal" is a private or internal name',
          "Relayer URL",
          "chargeRelayerUrl",
        ),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(json.data.details[0]).toMatchObject({ status: "failed" });
      expect(json.data.skipped).toBe(0);
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
      expect(lastErrorOf()).toContain("redirect");
      expect(lastErrorOf()).not.toContain("169.254");
      expect(json.data.details[0]).toMatchObject({ status: "failed" });
    });

    it("never persists the upstream response body", async () => {
      primeUserDeployment();
      stubFetch(
        new Response("root:x:0:0:root:/root:/bin/bash\nSECRET_TOKEN=abc123", { status: 500 }),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(lastErrorOf()).toBe("User relayer returned 500");
      const persisted = JSON.stringify(mockDb.payrollRun.update.mock.calls) + JSON.stringify(json);
      expect(persisted).not.toContain("SECRET_TOKEN");
      expect(persisted).not.toContain("root:x:0:0");
    });

    it("never persists an errorMessage from a 2xx payload", async () => {
      primeUserDeployment();
      stubFetch(
        new Response(JSON.stringify({ status: "FAILED", errorMessage: "SECRET_TOKEN=abc123" }), {
          status: 200,
        }),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(lastErrorOf()).toBe("User relayer did not return a success payload");
      expect(JSON.stringify(json)).not.toContain("SECRET_TOKEN");
    });

    it("rejects a payload whose txHash is not a transaction hash", async () => {
      primeUserDeployment();
      stubFetch(
        new Response(JSON.stringify({ status: "SUCCESS", txHash: "../../evil" }), { status: 200 }),
      );

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(lastErrorOf()).toBe("User relayer returned an unrecognised payload");
      expect(mockDb.payrollPayout.create).not.toHaveBeenCalled();
      expect(JSON.stringify(json)).not.toContain("evil");
    });

    it("rejects a non-JSON 200 without quoting it", async () => {
      primeUserDeployment();
      stubFetch(new Response("<html>SECRET_TOKEN=abc123</html>", { status: 200 }));

      const json = await (await POST(makeRequest("cron-secret"))).json();

      expect(lastErrorOf()).toBe("User relayer returned an unrecognised payload");
      expect(JSON.stringify(json)).not.toContain("SECRET_TOKEN");
    });
  });
});
