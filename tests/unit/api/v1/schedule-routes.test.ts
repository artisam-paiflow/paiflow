import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({
  db: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  service: vi.fn(),
  state: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: mocks.service,
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => {
    await mocks.service();
    return fn();
  },
}));
vi.mock("@/lib/api/v1/schedule", async (original) => ({
  ...(await original<typeof import("@/lib/api/v1/schedule")>()),
  scheduleState: mocks.state,
  prepareScheduleControl: mocks.prepare,
  submitScheduleControl: mocks.submit,
  reconcileScheduleControl: mocks.reconcile,
}));
import { GET } from "@/app/api/v1/deployments/[id]/schedule/state/route";
import { POST as pause } from "@/app/api/v1/deployments/[id]/schedule/pause/route";
import { POST as resume } from "@/app/api/v1/deployments/[id]/schedule/resume/route";
import { POST as retrieve } from "@/app/api/v1/deployments/[id]/schedule/retrieve/route";
import { POST as pauseSubmit } from "@/app/api/v1/deployments/[id]/schedule/pause/submit/route";
import { POST as resumeSubmit } from "@/app/api/v1/deployments/[id]/schedule/resume/submit/route";
import { POST as retrieveSubmit } from "@/app/api/v1/deployments/[id]/schedule/retrieve/submit/route";
import { POST as pauseReconcile } from "@/app/api/v1/deployments/[id]/schedule/pause/reconcile/route";
import { POST as resumeReconcile } from "@/app/api/v1/deployments/[id]/schedule/resume/reconcile/route";
import { POST as retrieveReconcile } from "@/app/api/v1/deployments/[id]/schedule/retrieve/reconcile/route";
import { AppError } from "@/lib/errors";
import { ctx, DEPLOYMENT_ID, newToken, tokenRow } from "./execute-fixtures";
const wallet = Keypair.random().publicKey();
const intent = "00000000-0000-4000-8000-000000000001";
let token: ReturnType<typeof newToken>;
let row: ReturnType<typeof tokenRow>;
const routes = [
  ["state", GET],
  ["pause", pause],
  ["resume", resume],
  ["retrieve", retrieve],
  ["pause/submit", pauseSubmit],
  ["resume/submit", resumeSubmit],
  ["retrieve/submit", retrieveSubmit],
  ["pause/reconcile", pauseReconcile],
  ["resume/reconcile", resumeReconcile],
  ["retrieve/reconcile", retrieveReconcile],
] as const;
function call(
  route: (typeof routes)[number],
  body: unknown = {},
  authorization = `Bearer ${token.plaintext}`,
  query = "",
) {
  const [suffix, fn] = route;
  return fn(
    new Request(
      `https://paiflow.test/api/v1/deployments/${DEPLOYMENT_ID}/schedule/${suffix}${query}`,
      {
        method: suffix === "state" ? "GET" : "POST",
        headers: { authorization, "Content-Type": "application/json" },
        ...(suffix === "state" ? {} : { body: JSON.stringify(body) }),
      },
    ) as NextRequest,
    ctx(DEPLOYMENT_ID),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  row = tokenRow(token, { network: "testnet" });
  mocks.db.deploymentApiToken.findUnique.mockResolvedValue(row);
  mocks.db.deploymentApiToken.update.mockResolvedValue({});
  mocks.service.mockResolvedValue(undefined);
  mocks.state.mockResolvedValue({ paused: true });
  mocks.prepare.mockResolvedValue({ intent, unsignedXdr: "unsigned" });
  mocks.submit.mockResolvedValue({ status: "UNKNOWN" });
  mocks.reconcile.mockResolvedValue({ state: "PREPARED", replacementAllowed: false });
});
describe("Schedule v1 route guards", () => {
  it.each(routes)("%s refuses unauthenticated callers", async (suffix, fn) => {
    expect((await call([suffix, fn], {}, "")).status).toBe(401);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(routes)("%s refuses a token from another deployment", async (suffix, fn) => {
    row.deploymentId = "00000000-0000-4000-8000-000000000009";
    expect((await call([suffix, fn])).status).toBe(401);
  });
  it.each(routes)("%s refuses retired service before domain work", async (suffix, fn) => {
    mocks.service.mockRejectedValue(new AppError("CONFLICT", "Deployment service is closed"));
    expect((await call([suffix, fn])).status).toBe(409);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("reads without session and sends no-store header", async () => {
    const response = await call(routes[0], {}, undefined, "?nodeId=schedule");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.state).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEPLOYMENT_ID }),
      "schedule",
    );
  });
  it("fails unknown query fields", async () => {
    expect((await call(routes[0], {}, undefined, "?contractAddress=bad")).status).toBe(422);
  });
  it.each(routes.slice(1, 4))(
    "%s binds server action and parses strict body",
    async (suffix, fn) => {
      expect((await call([suffix, fn], { walletAddress: wallet })).status).toBe(200);
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ id: DEPLOYMENT_ID }),
        suffix,
        { walletAddress: wallet },
      );
      expect((await call([suffix, fn], { walletAddress: wallet, recipient: wallet })).status).toBe(
        422,
      );
    },
  );
  it.each(routes.slice(4, 7))(
    "%s keeps uncertain response and does not bypass foundation",
    async (suffix, fn) => {
      const response = await call([suffix, fn], { intent, signedXdr: "signed" });
      expect(response.status).toBe(200);
      expect((await response.json()).data.status).toBe("UNKNOWN");
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: suffix.split("/")[0],
          deployment: expect.objectContaining({ id: DEPLOYMENT_ID }),
          tokenId: token.id,
          intent,
          signedXdr: "signed",
        }),
      );
      expect(
        (await call([suffix, fn], { intent, signedXdr: "signed", action: "pause" })).status,
      ).toBe(422);
    },
  );
  it.each(routes.slice(7))("%s never clears uncertain reservations", async (suffix, fn) => {
    const response = await call([suffix, fn], { intent });
    expect(response.status).toBe(200);
    expect((await response.json()).data.replacementAllowed).toBe(false);
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEPLOYMENT_ID }),
      suffix.split("/")[0],
      intent,
    );
    expect((await call([suffix, fn], { intent, txHash: "a".repeat(64) })).status).toBe(422);
  });
});

describe("Malformed Schedule JSON", () => {
  it.each(routes.slice(1))("%s returns structured 422 before domain work", async (_suffix, fn) => {
    const response = await fn(
      new Request(`https://paiflow.test/api/v1/deployments/${DEPLOYMENT_ID}/schedule/pause`, {
        method: "POST",
        headers: { authorization: `Bearer ${token.plaintext}`, "Content-Type": "application/json" },
        body: "{",
      }) as NextRequest,
      ctx(DEPLOYMENT_ID),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
