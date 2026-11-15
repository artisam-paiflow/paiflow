import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, conditionalMutationFixture } from "./conditional-mutation-fixtures";

const mock = vi.hoisted(() => ({
  session: vi.fn(),
  deployment: vi.fn(),
  state: vi.fn(),
  history: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
  v1: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mock.session }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: mock.deployment } } }));
vi.mock("@/lib/deployments/service-route", () => ({ deploymentServiceRoute: (fn: unknown) => fn }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: mock.limit }));
vi.mock("@/lib/stellar/conditional-mutation-state", () => ({
  readConditionalMutationState: mock.state,
}));
vi.mock("@/lib/mutations/conditional-history", () => ({
  conditionalConfigurationHistory: mock.history,
}));
vi.mock("@/lib/mutations/conditional-service", () => ({
  prepareConditionalMutation: mock.prepare,
  submitConditionalMutation: mock.submit,
  reconcileConditionalMutation: mock.reconcile,
}));
vi.mock("@/lib/mutations/service", () => ({
  prepareMutation: mock.v1,
  submitMutation: mock.v1,
  reconcileMutation: mock.v1,
}));
vi.mock("@/lib/mutations/history", () => ({ configurationHistory: mock.v1 }));
vi.mock("@/lib/stellar/mutation-state", () => ({ readMutationState: mock.v1 }));
import { ownerMutationRoute, runMutationAction } from "@/lib/mutations/http";

const fixture = conditionalMutationFixture();
const id = fixture.deployment.id;
const ownerId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const request = (query = "?version=2", body?: unknown, key = "update:1") =>
  new NextRequest(`https://app.invalid/api/deployments/${id}/configuration${query}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({ id: ownerId, role: "USER" });
  mock.deployment.mockResolvedValue(fixture.deployment);
  mock.state.mockResolvedValue(fixture.current);
  mock.history.mockResolvedValue({ version: 2, historyComplete: false });
  mock.prepare.mockResolvedValue({ intent: id, txHash: "ab".repeat(32) });
  mock.submit.mockResolvedValue({ status: "UNKNOWN" });
  mock.reconcile.mockResolvedValue({ transaction: { txHash: "ab".repeat(32) } });
});
describe("explicit owner and partner conditional mutation dispatch", () => {
  it.each(["state", "history", "prepare", "submit", "reconcile"] as const)(
    "owner %s requires explicitv2 and preserves admission/identity attribution",
    async (action) => {
      const body =
        action === "prepare"
          ? { admin: admin.publicKey(), arguments: fixture.mutation.arguments }
          : action === "submit"
            ? { intent: id, signedXdr: "signed-fixture" }
            : action === "reconcile"
              ? { intent: id }
              : undefined;
      const response = await ownerMutationRoute(action)(request("?version=2", body), context);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mock.v1).not.toHaveBeenCalled();
      const selected =
        action === "state"
          ? mock.state
          : action === "history"
            ? mock.history
            : action === "prepare"
              ? mock.prepare
              : action === "submit"
                ? mock.submit
                : mock.reconcile;
      expect(selected).toHaveBeenCalledOnce();
      if (action === "submit")
        expect(mock.submit).toHaveBeenCalledWith(
          expect.objectContaining({
            ownerSessionId: ownerId,
            assertAdmission: expect.any(Function),
          }),
        );
      selected.mockClear();
      await expect(ownerMutationRoute(action)(request("", body), context)).rejects.toMatchObject({
        code: "VALIDATION",
      });
      expect(selected).not.toHaveBeenCalled();
    },
  );
  it("removes only the validatedversion before strict history query parsing and preserves duplicates rejection", async () => {
    await ownerMutationRoute("history")(request("?version=2&limit=2"), context);
    expect(mock.history).toHaveBeenCalledWith(id, { limit: 2 });
    await expect(
      ownerMutationRoute("history")(request("?version=2&limit=2&limit=3"), context),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      ownerMutationRoute("history")(request("?version=2&unknown=1"), context),
    ).rejects.toThrow();
  });
  it.each(["?version=2&version=2", "?version=99"])(
    "rejects invalid selector %s before domain work",
    async (query) => {
      await expect(ownerMutationRoute("state")(request(query), context)).rejects.toThrow();
      expect(mock.state).not.toHaveBeenCalled();
    },
  );
  it("retains adminbody and requiredkey without accepting a v1group under version2", async () => {
    const body = { admin: admin.publicKey(), arguments: fixture.mutation.arguments };
    await expect(
      ownerMutationRoute("prepare")(request("?version=2", body, ""), context),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      ownerMutationRoute("prepare")(
        request("?version=2", { ...body, arguments: { version: 1, changes: [] } }),
        context,
      ),
    ).rejects.toThrow();
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("does not allow ended/foreign/sandbox owner requests to reach conditional state", async () => {
    mock.session.mockRejectedValue(new Error("ended"));
    await expect(ownerMutationRoute("state")(request(), context)).rejects.toThrow("ended");
    mock.session.mockResolvedValue({ id: ownerId, role: "SANDBOX" });
    await expect(ownerMutationRoute("state")(request(), context)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    mock.session.mockResolvedValue({ id: ownerId, role: "USER" });
    mock.deployment.mockResolvedValue(null);
    await expect(ownerMutationRoute("state")(request(), context)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mock.state).not.toHaveBeenCalled();
  });
  it("passes partner credential attribution to the same sender and requires no owner impersonation", async () => {
    const credential = {
      token: { id: "token" },
      tokenType: "deployment_token",
      deployment: fixture.deployment,
      ownerId,
    } as Parameters<typeof runMutationAction>[3];
    await runMutationAction(
      "submit",
      request("?version=2", { intent: id, signedXdr: "signed-fixture" }),
      fixture.deployment,
      credential,
    );
    expect(mock.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: "token",
        tokenType: "deployment_token",
        ownerSessionId: undefined,
        assertAdmission: expect.any(Function),
      }),
    );
  });
});
