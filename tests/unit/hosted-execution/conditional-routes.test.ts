import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const m = vi.hoisted(() => ({
  deployment: vi.fn(),
  state: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  visibility: vi.fn(),
  challenge: vi.fn(),
  legacy: vi.fn(),
  session: vi.fn(),
  db: { deployment: { findFirst: vi.fn() } },
  rate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auth", () => ({ requireSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", enforceRateLimit: m.rate }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/hosted-execution/service", () => ({
  hostedDeployment: m.legacy,
  prepareHostedPayment: m.legacy,
  readHostedReceipt: m.legacy,
  reconcileHostedPayment: m.legacy,
  setHostedVisibility: m.legacy,
  submitHostedPayment: m.legacy,
}));
vi.mock("@/lib/hosted-execution/conditional-service", async (original) => ({
  ...(await original<typeof import("@/lib/hosted-execution/conditional-service")>()),
  conditionalHostedDeployment: m.deployment,
  readConditionalHostedState: m.state,
  prepareConditionalHostedPayment: m.prepare,
  submitConditionalHostedPayment: m.submit,
  reconcileConditionalHostedPayment: m.receipt,
  setConditionalHostedVisibility: m.visibility,
}));
vi.mock("@/lib/stellar/conditional-hosted-ownership", () => ({
  createConditionalHostedOwnershipChallenge: m.challenge,
}));
import { hostedPublicRoute, updateHostedVisibility } from "@/lib/hosted-execution/routes";
const id = "abcdefab-1234-4234-8234-abcdefabcdef",
  key = "ab".repeat(32),
  address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const payment = { from: address, amount: "1000", arguments: { version: 2, inputs: [] } };
const inputs = {
  state: undefined,
  ownership: { recoveryKey: key, payment },
  prepare: { recoveryKey: key, payment },
  submit: {
    recoveryKey: key,
    intent: "22222222-2222-4222-8222-222222222222",
    signedXdr: "signed-placeholder",
  },
  receipt: { recoveryKey: key },
};
function req(action: keyof typeof inputs, query = "?version=2", body: unknown = inputs[action]) {
  return new NextRequest(
    `http://localhost/api/deployments/${id}/hosted-execution/${action}${query}`,
    action === "state"
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.deployment.mockResolvedValue({
    id,
    status: "CONFIRMED",
    network: "testnet",
    serviceState: "ACTIVE",
  });
  m.state.mockResolvedValue({ version: 2, supported: true });
  m.prepare.mockResolvedValue({ version: 2, prepared: { intent: "original" } });
  m.submit.mockResolvedValue({ version: 2, txHash: "a".repeat(64), status: "UNKNOWN" });
  m.receipt.mockResolvedValue({ version: 2, intent: "original" });
  m.challenge.mockReturnValue({ version: 2, xdr: "challenge" });
  m.visibility.mockResolvedValue({ enabled: false });
  m.legacy.mockResolvedValue({ id, hostedExecutionEnabled: true });
  m.session.mockResolvedValue({ id: "owner", role: "USER" });
  m.db.deployment.findFirst.mockResolvedValue({ id, ownerId: "owner" });
});
it.each(["state", "ownership", "prepare", "submit", "receipt"] as const)(
  "dispatches explicitv2 %s with canonical serverUUID and no legacy fallback",
  async (action) => {
    const response = await hostedPublicRoute(action)(req(action), {
      params: Promise.resolve({ id: id.toUpperCase() }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(m.legacy).not.toHaveBeenCalled();
    if (action === "ownership") expect(m.challenge).toHaveBeenCalledWith(id, inputs.ownership);
    if (action === "submit") expect(m.submit.mock.calls[0]![0].id).toBe(id);
    if (action === "receipt") expect(m.receipt.mock.calls[0]![0].id).toBe(id);
    expect(m.rate).toHaveBeenCalledTimes(2);
  },
);
it.each(["?version=3", "?version=2&version=1", "?version=2&version=2"])(
  "rejects unknown/duplicate selector %s before service dispatch",
  async (query) => {
    const response = await hostedPublicRoute("prepare")(req("prepare", query), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(422);
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.legacy).not.toHaveBeenCalled();
  },
);
it("missing/1 selector retains v1 wrapper and strictv2 body cannot fall into v1", async () => {
  const response = await hostedPublicRoute("prepare")(req("prepare", ""), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(422);
  expect(m.legacy).toHaveBeenCalled();
  expect(m.prepare).not.toHaveBeenCalled();
});
it.each(["state", "ownership", "prepare", "submit", "receipt"] as const)(
  "sanitizes private diagnostics/messages/fields on publicv2 %s errors",
  async (action) => {
    const failure = new AppError(
      "UPSTREAM_RPC",
      "private-canary",
      { email: ["private-canary"], intent: ["private-canary"] },
      "private-canary",
      7,
    );
    if (action === "ownership")
      m.challenge.mockImplementation(() => {
        throw failure;
      });
    else m[action].mockRejectedValue(failure);
    const response = await hostedPublicRoute(action)(req(action), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(JSON.stringify(await response.json())).not.toContain("private-canary");
  },
);
it("preserves only fixed ownership-required field for same-original reproof", async () => {
  m.prepare.mockRejectedValue(
    new AppError(
      "VALIDATION",
      "Verify ownership of the payer wallet before preparing this payment",
      { ownershipProofXdr: ["A current wallet ownership signature is required"] },
    ),
  );
  const response = await hostedPublicRoute("prepare")(req("prepare"), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(422);
  expect((await response.json()).error.fields).toEqual({
    ownershipProofXdr: ["A current wallet ownership signature is required"],
  });
});
it("owner visibility uses explicitv2 without changing old bool body/session/rate admission", async () => {
  const response = await updateHostedVisibility(
    new NextRequest(`http://localhost/api/deployments/${id}/hosted-execution?version=2`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  expect(m.visibility).toHaveBeenCalledWith(
    expect.objectContaining({ id }),
    "owner",
    false,
    "127.0.0.1",
  );
  expect(m.legacy).not.toHaveBeenCalled();
});
it("owner visibility refuses sandbox and unknown selectors", async () => {
  m.session.mockResolvedValue({ id: "owner", role: "SANDBOX" });
  const response = await updateHostedVisibility(
    new NextRequest(`http://localhost/api/deployments/${id}/hosted-execution?version=2`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    }),
    { params: Promise.resolve({ id }) },
  ).catch((error) => error);
  expect(response).toMatchObject({ code: "FORBIDDEN" });
  expect(m.visibility).not.toHaveBeenCalled();
});
