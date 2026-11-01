import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  readReceipt: vi.fn(),
  visibility: vi.fn(),
  rate: vi.fn(),
  session: vi.fn(),
  state: vi.fn(),
  dbRead: vi.fn(),
}));
vi.mock("@/lib/hosted-execution/service", () => ({
  hostedDeployment: mocks.deployment,
  prepareHostedPayment: mocks.prepare,
  submitHostedPayment: mocks.submit,
  reconcileHostedPayment: mocks.receipt,
  readHostedReceipt: mocks.readReceipt,
  setHostedVisibility: mocks.visibility,
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mocks.dbRead } } }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "ip", enforceRateLimit: mocks.rate }));
vi.mock("@/lib/stellar/execution-state", () => ({ readExecutionState: mocks.state }));
vi.mock("@/lib/stellar/interactive-rpc-budget", () => ({
  withInteractiveRpcBudget: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/deployments/service-work", () => ({
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/deployments/service-route", async () => ({
  deploymentServiceRoute:
    (fn: (req: NextRequest, ctx: unknown) => Promise<Response>) =>
    async (req: NextRequest, ctx: unknown) =>
      (await import("@/lib/errors")).withErrorHandler(() => fn(req, ctx)),
}));
import { POST as prepareRoute } from "@/app/api/deployments/[id]/hosted-execution/prepare/route";
import { POST as ownershipRoute } from "@/app/api/deployments/[id]/hosted-execution/ownership/route";
import { POST as submitRoute } from "@/app/api/deployments/[id]/hosted-execution/submit/route";
import { POST as receiptRoute } from "@/app/api/deployments/[id]/hosted-execution/receipt/route";
import { GET as stateRoute } from "@/app/api/deployments/[id]/hosted-execution/state/route";
import { PATCH as visibilityRoute } from "@/app/api/deployments/[id]/hosted-execution/route";
import { deploymentId, hostedState, payment, preparation, intentId } from "./fixtures";

const key = "ab".repeat(32);
const context = { params: Promise.resolve({ id: deploymentId }) };
const request = (body?: unknown, method = "POST") =>
  new NextRequest(`https://paiflow.test/api/deployments/${deploymentId}/hosted-execution`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.deployment.mockResolvedValue({ id: deploymentId });
  mocks.prepare.mockResolvedValue(preparation(payment));
  mocks.state.mockResolvedValue(hostedState);
  mocks.readReceipt.mockResolvedValue({ id: intentId });
  mocks.receipt.mockResolvedValue({ intent: intentId, state: "SUBMITTING" });
  mocks.submit.mockResolvedValue({ txHash: "ab".repeat(32), status: "UNKNOWN" });
  mocks.session.mockResolvedValue({ id: "owner", role: "USER" });
  mocks.dbRead.mockResolvedValue({ id: deploymentId, ownerId: "owner" });
  mocks.visibility.mockResolvedValue({ enabled: true });
});
describe("hosted public handlers", () => {
  it.each([
    ["state", stateRoute],
    ["ownership", ownershipRoute],
    ["prepare", prepareRoute],
    ["submit", submitRoute],
    ["receipt", receiptRoute],
  ] as const)("enforces the shared limiter before any %s domain work", async (_action, route) => {
    mocks.rate.mockRejectedValueOnce(new AppError("RATE_LIMITED", "Rate limit exceeded"));
    expect((await route(request({}), context)).status).toBe(429);
    expect(mocks.deployment).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("issues a rate-limited stateless ownership challenge only after opt-in without preparing a payment", async () => {
    const response = await ownershipRoute(request({ recoveryKey: key, payment }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual([
      "bindingDigest",
      "network",
      "networkPassphrase",
      "xdr",
    ]);
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
    expect(mocks.deployment).toHaveBeenCalledWith(deploymentId, true);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(
      (await ownershipRoute(request({ recoveryKey: key, payment, token: "secret" }), context))
        .status,
    ).toBe(422);
    mocks.deployment.mockRejectedValueOnce(new AppError("NOT_FOUND", "Payment form unavailable"));
    expect((await ownershipRoute(request({ recoveryKey: key, payment }), context)).status).toBe(
      404,
    );
  });
  it("permits a wallet-only preparation after rate/visibility guards, not a Paiflow session", async () => {
    const response = await prepareRoute(request({ recoveryKey: key, payment }), context);
    expect(response.status).toBe(200);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledTimes(2);
    expect(mocks.deployment).toHaveBeenCalledWith(deploymentId, true);
    expect(mocks.prepare).toHaveBeenCalledWith({ id: deploymentId }, { recoveryKey: key, payment });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("refuses disabled forms and malformed bodies before simulation or submit", async () => {
    mocks.deployment.mockRejectedValueOnce(new AppError("NOT_FOUND", "Payment form unavailable"));
    expect((await prepareRoute(request({ recoveryKey: key, payment }), context)).status).toBe(404);
    expect(
      (await prepareRoute(request({ recoveryKey: key, payment, token: "pfk_secret" }), context))
        .status,
    ).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("scopes receipt access before submission and leaves recovery available after opt-out", async () => {
    mocks.readReceipt.mockRejectedValueOnce(new AppError("NOT_FOUND", "Payment receipt not found"));
    expect(
      (
        await submitRoute(
          request({ recoveryKey: key, intent: intentId, signedXdr: "signedfixture" }),
          context,
        )
      ).status,
    ).toBe(404);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((await receiptRoute(request({ recoveryKey: key }), context)).status).toBe(200);
    expect(mocks.deployment).toHaveBeenLastCalledWith(deploymentId, false);
    expect(mocks.receipt).toHaveBeenCalledWith({ id: deploymentId }, key);
  });
  it("does not return contact, owner or API credentials in public state", async () => {
    const response = await stateRoute(request(undefined, "GET"), context);
    const data = await response.json();
    expect(data.data).toEqual(hostedState);
    for (const field of ["email", "webhookSecret", "tokenHash", "ownerId", "graphSnapshot"])
      expect(JSON.stringify(data)).not.toContain(field);
  });
  it("rejects malformed deployment identity and invalid JSON before domain work", async () => {
    expect(
      (await prepareRoute(request({}), { params: Promise.resolve({ id: "invalid" }) })).status,
    ).toBe(404);
    const invalid = new NextRequest("https://paiflow.test/", { method: "POST", body: "{" });
    expect((await prepareRoute(invalid, context)).status).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
describe("owner visibility handler", () => {
  it("requires an owner session and passes validated state to the audited service", async () => {
    expect((await visibilityRoute(request({ enabled: true }, "PATCH"), context)).status).toBe(200);
    expect(mocks.dbRead).toHaveBeenCalledWith({ where: { id: deploymentId, ownerId: "owner" } });
    expect(mocks.visibility).toHaveBeenCalledWith(
      { id: deploymentId, ownerId: "owner" },
      "owner",
      true,
      "ip",
    );
  });
  it("rejects missing sessions, sandbox callers, cross-owner objects and malformed updates", async () => {
    mocks.session.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "Login required"));
    expect((await visibilityRoute(request({ enabled: true }, "PATCH"), context)).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ id: "sandbox", role: "SANDBOX" });
    expect((await visibilityRoute(request({ enabled: true }, "PATCH"), context)).status).toBe(403);
    mocks.dbRead.mockResolvedValueOnce(null);
    expect((await visibilityRoute(request({ enabled: true }, "PATCH"), context)).status).toBe(404);
    expect(
      (await visibilityRoute(request({ enabled: true, ownerId: "other" }, "PATCH"), context))
        .status,
    ).toBe(422);
    expect(mocks.visibility).not.toHaveBeenCalled();
  });
});
