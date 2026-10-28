import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { AppError } from "@/lib/errors";

const PUBLIC_ORIGIN = vi.hoisted(() => {
  const origin = "https://customer.paiflow.test";
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  return origin;
});
afterAll(() => vi.unstubAllEnvs());

// Keep the actual route wrapper and durable service-work implementation: the
// public-embed domain suite mocks the wrapper and cannot catch an owner gate.
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owned: vi.fn(),
  deployment: vi.fn(),
  lock: vi.fn(),
  create: vi.fn(),
  finish: vi.fn(),
  cleanup: vi.fn(),
  admissionRate: vi.fn(),
  publicRate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session, requireDevAuth: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: mocks.lock, deploymentWork: { create: mocks.create } };
  return {
    db: {
      $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
      deployment: { findFirst: mocks.owned, findUnique: mocks.deployment },
      deploymentWork: { updateMany: mocks.finish, deleteMany: mocks.cleanup },
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "198.51.100.1",
  enforceRateLimit: mocks.admissionRate,
  rateLimit: mocks.publicRate,
  retryAfterSeconds: () => 15,
}));
vi.mock("@/lib/api/v1/events-freshness", () => ({ refreshEventsIfStale: vi.fn() }));
import { GET } from "@/app/api/deployments/[id]/embed/qr/route";

const ID = "11111111-1111-4111-8111-111111111111";
const WORK_ID = "test-qr-work";
const PRIVATE = "private-synthetic-marker";
const row = () => ({
  id: ID,
  ownerId: "owner",
  status: "CONFIRMED",
  serviceState: "ACTIVE",
  contractAddress: "C" + "A".repeat(55),
  network: "testnet",
  webhookSecret: PRIVATE,
  flow: { templateKind: "SPLITTER" },
  pipelineSnapshot: [{ templateKind: "DEPOSIT_TRIGGER", secret: PRIVATE }],
  graphSnapshot: {
    nodes: [{ id: "root", type: "on_receive", config: { asset: { kind: "native" } } }],
    edges: [],
  },
});
const request = (id = ID, query = "", origin = "https://paiflow.test", headers?: HeadersInit) =>
  GET(new NextRequest(`${origin}/api/deployments/${id}/embed/qr${query}`, { headers }), {
    params: Promise.resolve({ id }),
  });
const expectCleanedUp = () => {
  expect(mocks.finish).toHaveBeenCalledWith({
    where: { id: WORK_ID, state: "OPEN" },
    data: { state: "DONE", blocker: null, completedAt: expect.any(Date) },
  });
  expect(mocks.cleanup).toHaveBeenCalledWith({
    where: { id: WORK_ID, state: "DONE", transactions: { none: {} } },
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Authentication required"));
  mocks.lock.mockResolvedValue([{ id: ID, serviceState: "ACTIVE" }]);
  mocks.create.mockResolvedValue({ id: WORK_ID });
  mocks.deployment.mockResolvedValue(row());
  mocks.publicRate.mockResolvedValue({ ok: true });
});

describe("public embed QR through real service admission", () => {
  it.each([null, "owner", "another-owner"])(
    "returns the same customer-page SVG for viewer %s without checking ownership",
    async (viewer) => {
      if (viewer) mocks.session.mockResolvedValue({ id: viewer, role: "USER" });
      const res = await request();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const svg = await res.text();
      expect(svg).toBe(
        await QRCode.toString(`${PUBLIC_ORIGIN}/trigger/${ID}`, {
          type: "svg",
          width: 256,
          margin: 2,
        }),
      );
      expect(svg).not.toContain(PRIVATE);
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks.owned).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledWith({
        data: { deploymentId: ID, kind: `/api/deployments/${ID}/embed/qr` },
      });
      expectCleanedUp();
    },
  );

  it.each([
    ["internal request origin", "https://localhost:8080", {}],
    [
      "spoofed proxy headers",
      "https://localhost:8080",
      {
        host: "attacker.invalid",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
      },
    ],
  ])("encodes the configured public customer URL despite %s", async (_label, origin, headers) => {
    const res = await request(ID, "", origin, headers);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      await QRCode.toString(`${PUBLIC_ORIGIN}/trigger/${ID}`, {
        type: "svg",
        width: 256,
        margin: 2,
      }),
    );
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.owned).not.toHaveBeenCalled();
    expectCleanedUp();
  });

  it("rejects malformed ids before SQL or durable admission", async () => {
    expect((await request("bad-id")).status).toBe(404);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deployment).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", [], 404],
    ["retiring", [{ id: ID, serviceState: "RETIRING" }], 409],
    ["retired", [{ id: ID, serviceState: "RETIRED" }], 404],
  ])("rejects %s deployments at admission", async (_label, rows, status) => {
    mocks.lock.mockResolvedValue(rows);
    expect((await request()).status).toBe(status);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deployment).not.toHaveBeenCalled();
  });

  it.each([
    ["missing public row", null],
    ["unconfirmed", { ...row(), status: "PENDING_SIGNATURE" }],
    ["retirement after admission", { ...row(), serviceState: "RETIRING" }],
    ["no contract", { ...row(), contractAddress: null }],
    ["invalid graph", { ...row(), graphSnapshot: {} }],
    ["unknown network", { ...row(), network: "unknown" }],
    [
      "unsupported payment",
      {
        ...row(),
        flow: { templateKind: "SUBSCRIPTION" },
        pipelineSnapshot: [{ templateKind: "SUBSCRIPTION" }],
      },
    ],
  ])("retains public validation for %s and closes admitted work", async (_label, deployment) => {
    mocks.deployment.mockResolvedValue(deployment);
    expect((await request()).status).toBe(404);
    expectCleanedUp();
  });

  it.each(["invoke", "allowance", "trigger", "pay"])(
    "rejects generic QR action %s and closes admitted work",
    async (action) => {
      expect((await request(ID, `?action=${action}`)).status).toBe(422);
      expect(mocks.deployment).not.toHaveBeenCalled();
      expectCleanedUp();
    },
  );

  it("retains the address-wide service limit before database admission", async () => {
    mocks.admissionRate.mockRejectedValue(
      new AppError("RATE_LIMITED", "Too many requests", undefined, undefined, 15),
    );
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(mocks.admissionRate).toHaveBeenCalledWith({
      key: "service-admission:198.51.100.1",
      limit: 600,
      windowSeconds: 60,
    });
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("retains the shared public read limit and closes admitted work on rejection", async () => {
    mocks.publicRate.mockResolvedValue({ ok: false });
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(mocks.publicRate).toHaveBeenCalledWith("public-embed:reads:198.51.100.1", 600, 60);
    expect(mocks.deployment).not.toHaveBeenCalled();
    expectCleanedUp();
  });
});
