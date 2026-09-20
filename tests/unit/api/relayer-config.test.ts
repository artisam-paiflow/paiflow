/**
 * #581: the two relayer-config routes are what let a tenant point the server at
 * an internal host in the first place. The real guard runs here (only DNS is
 * mocked), so this is the end-to-end proof that the wiring is in place and that
 * a refusal never reaches `db.deployment.update`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockAudit, mockRateLimit, mockLookup } = vi.hoisted(() => ({
  mockDb: { deployment: { findFirst: vi.fn(), update: vi.fn() } },
  mockAudit: vi.fn(),
  mockRateLimit: vi.fn(),
  mockLookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ id: "owner-1", username: "owner", role: "USER" })),
}));
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mockRateLimit }));
vi.mock("@/lib/env", () => ({
  // `lib/log.ts` reads env() at import time, via lib/errors.
  env: () => ({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
  stellarRelayerAddress: () => "GDPLATFORMRELAYER",
  stellarPassphrase: () => "Test SDF Network ; September 2015",
}));
vi.mock("@/lib/stellar/invoke", () => ({
  preparePayrollSetRelayerInvocation: vi.fn(async () => ({ xdr: "set-relayer-xdr" })),
  prepareSubscriptionSetRelayerInvocation: vi.fn(async () => ({ xdr: "set-relayer-xdr" })),
}));
vi.mock("@/lib/stellar/relayer", () => ({
  readPayrollRelayer: vi.fn(async () => "GTENANT"),
  readSubscriptionRelayer: vi.fn(async () => "GTENANT"),
}));

import { AppError } from "@/lib/errors";
import { POST as payrollPOST } from "@/app/api/deployments/[id]/payroll-relayer/route";
import { POST as subscriptionPOST } from "@/app/api/deployments/[id]/subscription-relayer/route";

const DEP_ID = "11111111-1111-1111-1111-111111111111";
/** A real key: the schema checks the StrKey checksum. */
const TENANT = "GBY7NOTYN5D6ZBGGDNB2OEIBW4TNTV4QZKJXDNJG3MHNLI2KM6RFFSTW";

const KINDS = [
  { label: "payroll", post: payrollPOST, templateKind: "PAYROLL" },
  { label: "subscription", post: subscriptionPOST, templateKind: "SUBSCRIPTION" },
] as const;

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: DEP_ID }) };

function primeDeployment(templateKind: string) {
  mockDb.deployment.findFirst.mockResolvedValue({
    id: DEP_ID,
    ownerId: "owner-1",
    flow: { templateKind },
    pipelineSnapshot: [{ nodeId: "n1", contractAddress: "C123", templateKind }],
    sourceAccount: "GSOURCE",
    chargeRelayerAddress: "GTENANT",
  });
}

describe.each(KINDS)("$label relayer config", ({ post, templateKind }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(undefined);
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    primeDeployment(templateKind);
  });

  it.each([
    "http://relayer.example.com/charge",
    "https://127.0.0.1/charge",
    "https://10.0.0.5/charge",
    "https://[::1]/charge",
    "https://169.254.169.254/latest/meta-data/",
    "https://redis.railway.internal/charge",
    "https://minio/charge",
    "https://user:pass@relayer.example.com/charge",
  ])("refuses %s with a 422 and stores nothing", async (url) => {
    const res = await post(makeRequest({ mode: "USER", url, relayerAddress: TENANT }), ctx);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION");
    expect(json.error.fields.url[0]).toContain("must be a public https:// endpoint");
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    const res = await post(
      makeRequest({
        mode: "USER",
        url: "https://relayer.example.com/charge",
        relayerAddress: TENANT,
      }),
      ctx,
    );

    expect(res.status).toBe(422);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });

  it("accepts a public https relayer URL and stores the validated value", async () => {
    const res = await post(
      makeRequest({
        mode: "USER",
        url: "https://relayer.example.com/charge",
        token: "tenant-token",
        relayerAddress: TENANT,
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(mockDb.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ chargeRelayerUrl: "https://relayer.example.com/charge" }),
      }),
    );
  });

  it("audits the save with the host only, never the token", async () => {
    await post(
      makeRequest({
        mode: "USER",
        url: "https://relayer.example.com/charge?key=s3cret",
        token: "tenant-token",
        relayerAddress: TENANT,
      }),
      ctx,
    );

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DEPLOY_RELAYER_CONFIG",
        metadata: expect.objectContaining({
          relayerHost: "relayer.example.com",
          hasToken: true,
        }),
      }),
    );
    const audited = JSON.stringify(mockAudit.mock.calls);
    expect(audited).not.toContain("tenant-token");
    expect(audited).not.toContain("s3cret");
  });

  it("does not resolve anything for MANUAL mode", async () => {
    const res = await post(makeRequest({ mode: "MANUAL" }), ctx);

    expect(res.status).toBe(200);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockDb.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ chargeRelayerUrl: null }) }),
    );
  });

  it("rate-limits configuration updates", async () => {
    mockRateLimit.mockRejectedValue(new AppError("RATE_LIMITED", "Too many"));

    const res = await post(
      makeRequest({
        mode: "USER",
        url: "https://relayer.example.com/charge",
        relayerAddress: TENANT,
      }),
      ctx,
    );

    expect(res.status).toBe(429);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });

  it("caps the stored URL and token length", async () => {
    const res = await post(
      makeRequest({
        mode: "USER",
        url: `https://${"a".repeat(2100)}.example.com/`,
        relayerAddress: TENANT,
      }),
      ctx,
    );

    expect(res.status).toBe(422);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });
});
