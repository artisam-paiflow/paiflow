import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  findDeployment: vi.fn(),
  createWork: vi.fn(),
  updateWork: vi.fn(),
  deleteWork: vi.fn(),
  session: vi.fn(),
  devAuth: vi.fn(),
  rateLimit: vi.fn(),
  paused: vi.fn(),
  available: vi.fn(),
  retrieveAllowed: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session, requireDevAuth: mocks.devAuth }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "127.0.0.1",
  enforceRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: mocks.lock,
        deploymentWork: { create: mocks.createWork },
      }),
    deployment: { findFirst: mocks.findDeployment },
    deploymentWork: { updateMany: mocks.updateWork, deleteMany: mocks.deleteWork },
  },
}));
vi.mock("@/lib/stellar/relayer", () => ({
  readStreamerPaused: mocks.paused,
  readStreamerAvailable: mocks.available,
  readStreamerRetrieveAllowed: mocks.retrieveAllowed,
}));

import middleware from "@/middleware";
import { GET } from "@/app/api/deployments/[id]/streamer-state/route";

const ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/api/deployments/${ID}/streamer-state`;
const CONTRACT = "schedule-contract-fixture";
const run = middleware as unknown as (
  req: NextRequest & { auth: { user: { id: string; role: string } } | null },
) => Response;

function request(path = PATH, role: string | null = null, method = "GET") {
  return Object.assign(new NextRequest(`https://paiflow.test${path}`, { method }), {
    auth: role ? { user: { id: "viewer", role } } : null,
  });
}

// Exercise middleware and the exported route together. The service wrapper and
// durable admission are real; only database, authentication and chain I/O are mocked.
async function dispatch(role: string | null = null) {
  const req = request(PATH, role);
  const response = run(req);
  if (response.headers.get("x-middleware-next") !== "1") return response;
  return GET(req, { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue([{ id: ID, serviceState: "ACTIVE" }]);
  mocks.findDeployment.mockResolvedValue({
    pipelineSnapshot: [{ nodeId: "schedule", contractAddress: CONTRACT, templateKind: "STREAMER" }],
  });
  mocks.createWork.mockResolvedValue({ id: "read-work" });
  mocks.paused.mockResolvedValue(true);
  mocks.available.mockResolvedValue(12345678901234567890n);
  mocks.retrieveAllowed.mockResolvedValue(true);
});

describe("public Schedule state boundary", () => {
  it.each([null, "USER"])(
    "serves state without requiring owner authentication (%s)",
    async (role) => {
      const response = await dispatch(role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { paused: true, available: "12345678901234567890", retrieveAllowed: true },
      });
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks.devAuth).not.toHaveBeenCalled();
      expect(mocks.findDeployment).toHaveBeenCalledWith({
        where: { id: ID, status: "CONFIRMED" },
        include: { flow: { select: { templateKind: true } } },
      });
      expect(mocks.paused).toHaveBeenCalledWith(CONTRACT);
      expect(mocks.available).toHaveBeenCalledWith(CONTRACT);
      expect(mocks.retrieveAllowed).toHaveBeenCalledWith(CONTRACT);
      expect(mocks.rateLimit).toHaveBeenCalledOnce();
      expect(mocks.createWork).toHaveBeenCalledWith({ data: { deploymentId: ID, kind: PATH } });
      expect(mocks.deleteWork).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["RETIRING", 409, "CONFLICT"],
    ["RETIRED", 404, "NOT_FOUND"],
  ])("retains %s admission denial for anonymous reads", async (serviceState, status, code) => {
    mocks.lock.mockResolvedValue([{ id: ID, serviceState }]);
    const response = await dispatch();
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(mocks.findDeployment).not.toHaveBeenCalled();
    expect(mocks.createWork).not.toHaveBeenCalled();
    expect(mocks.available).not.toHaveBeenCalled();
  });

  it("retains the confirmed-deployment check", async () => {
    mocks.findDeployment.mockResolvedValue(null);
    const response = await dispatch();
    expect(response.status).toBe(404);
    expect(mocks.available).not.toHaveBeenCalled();
  });

  it("retains sandbox exclusion ahead of the public path", async () => {
    const response = await dispatch("SANDBOX");
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.available).not.toHaveBeenCalled();
  });

  it.each(["invoke", "submit-invoke", "release-early"])(
    "keeps the %s mutation closed to anonymous callers",
    async (endpoint) => {
      const response = run(request(`/api/deployments/${ID}/${endpoint}`, null, "POST"));
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    },
  );

  it.each([
    `/api/deployments/${ID}/streamer-state/extra`,
    `/api/deployments/${ID}/streamer-state-submit`,
    `/api/deployments/${ID}/streamer-stateful`,
    `/api/deployments/${ID}/extra/streamer-state`,
    "/api/deployments/streamer-state",
  ])("does not open the nearby path %s", (path) => {
    expect(run(request(path)).status).toBe(401);
  });
});
