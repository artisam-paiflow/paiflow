import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  db: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  service: vi.fn(),
  work: vi.fn(),
  discover: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
  eligible: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: mocks.service,
  withDeploymentWork: mocks.work,
}));
vi.mock("@/lib/api/v1/funding", () => ({
  discoverFunding: mocks.discover,
  prepareFunding: mocks.prepare,
  assertFundingEligible: mocks.eligible,
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: mocks.submit }));
vi.mock("@/lib/api/v1/control-intent", () => ({ reconcileControlIntent: mocks.reconcile }));
import { GET, POST } from "@/app/api/v1/deployments/[id]/funding/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/funding/submit/route";
import { POST as reconcile } from "@/app/api/v1/deployments/[id]/funding/reconcile/route";
import {
  newToken,
  tokenRow,
  request,
  ctx,
  DEPLOYMENT_ID,
  TRIGGER,
  PAYER,
} from "./execute-fixtures";
import { Keypair } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { requestEndpoint } from "@/lib/api/request-history/schema";
import { eventProperties } from "@/lib/analytics/event-policy";
const intent = "00000000-0000-4000-8000-000000000001";
const fromAddress = Keypair.random().publicKey();
let token: ReturnType<typeof newToken>;
const prep = { fromAddress, tokenContractAddress: PAYER, amountStroops: "10000000" };
const handlers = [GET, POST, submit, reconcile];
function call(handler = POST, body: unknown = prep, auth = token.plaintext) {
  const path = `/api/v1/deployments/${DEPLOYMENT_ID}/funding${handler === submit ? "/submit" : handler === reconcile ? "/reconcile" : ""}`;
  const req =
    handler === GET
      ? (new Request(`https://test${path}`, {
          headers: { authorization: `Bearer ${auth}` },
        }) as NextRequest)
      : request(path, { token: auth, body });
  return handler(req, ctx());
}
beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(
    tokenRow(token, {
      network: "testnet",
      pipelineSnapshot: [
        { nodeId: "schedule", templateKind: "STREAMER", contractAddress: TRIGGER },
      ],
    }),
  );
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.work.mockImplementation(async (_id, _route, fn) => fn());
  mocks.service.mockResolvedValue(undefined);
  mocks.discover.mockResolvedValue({ nodes: [] });
  mocks.prepare.mockResolvedValue({ intent });
  mocks.submit.mockResolvedValue({ txHash: "a".repeat(64), network: "testnet", status: "PENDING" });
  mocks.reconcile.mockResolvedValue({
    id: intent,
    action: "schedule.fund",
    txHash: "a".repeat(64),
    network: "testnet",
    state: "PREPARED",
    maxTime: "2000000000",
  });
});
describe("funding authenticated routes", () => {
  it("discovers with deployment bearer and no session", async () => {
    const response = await call(GET);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.discover).toHaveBeenCalledWith(expect.objectContaining({ id: DEPLOYMENT_ID }));
  });
  it("prepares validated exact inputs", async () => {
    expect((await call()).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEPLOYMENT_ID }),
      prep,
    );
  });
  it("submits using durable foundation and live check only through its callback", async () => {
    expect(
      (await call(submit, { intent, action: "schedule.fund", signedXdr: "signed" })).status,
    ).toBe(200);
    const input = mocks.submit.mock.calls[0]![0];
    expect(input).toMatchObject({
      intent,
      action: "schedule.fund",
      signedXdr: "signed",
      tokenId: token.id,
    });
    expect(mocks.eligible).not.toHaveBeenCalled();
    await input.assertEligible();
    expect(mocks.eligible).toHaveBeenCalledWith(input.deployment, intent, "schedule.fund");
  });
  it("reconciles original preparation without permitting replacement on PREPARED", async () => {
    const response = await call(reconcile, { intent, action: "schedule.fund" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe("PREPARED");
    expect(mocks.reconcile).toHaveBeenCalledWith(intent, DEPLOYMENT_ID, "schedule.fund");
  });
  it.each(handlers)("refuses malformed token for every funding route", async (handler) => {
    expect((await call(handler, prep, "pkdev_bad")).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["revoked", "expired", "wrong-deployment", "retired"])(
    "refuses %s bearer before domain work",
    async (reason) => {
      const row = tokenRow(token);
      if (reason === "revoked") row.revokedAt = new Date() as never;
      if (reason === "expired") row.expiresAt = new Date(0) as never;
      if (reason === "wrong-deployment") row.deploymentId = intent;
      if (reason === "retired") row.deployment.serviceState = "RETIRED";
      mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
      expect((await call()).status).toBe(401);
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );
  it("rejects retirement race through durable route admission", async () => {
    mocks.work.mockRejectedValue(new AppError("CONFLICT", "closed"));
    expect((await call()).status).toBe(409);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("refuses invalid fields before simulation", async () => {
    expect((await call(POST, { ...prep, secretKey: "never-accept" })).status).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("propagates unknown transaction status without preparing or sending another", async () => {
    mocks.submit.mockResolvedValue({
      txHash: "a".repeat(64),
      network: "testnet",
      status: "UNKNOWN",
    });
    const r = await call(submit, { intent, action: "webhook.fund", signedXdr: "signed" });
    expect((await r.json()).data.status).toBe("UNKNOWN");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(["funding", "funding/submit", "funding/reconcile"])(
    "retains allowlisted %s history and analytics paths",
    (suffix) => {
      const path = `/api/v1/deployments/${DEPLOYMENT_ID}/${suffix}`;
      const endpoint = `/api/v1/deployments/:id/${suffix}`;
      expect(requestEndpoint(path)).toBe(endpoint);
      expect(eventProperties("api_request_completed", { endpoint })?.endpoint).toBe(endpoint);
    },
  );
});
