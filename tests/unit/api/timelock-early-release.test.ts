/**
 * #751: early release of a timelock_branch's before side, through the owner's
 * session route and the partner API. Auth on the v1 route runs for real against
 * a mocked token table; the relayer calls are mocked so the side passed to them
 * is what is asserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";

const { mockDb, mockRequireSession, mockSimulate, mockSend } = vi.hoisted(() => ({
  mockDb: {
    deployment: { findFirst: vi.fn() },
    deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() },
  },
  mockRequireSession: vi.fn(),
  mockSimulate: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/auth", () => ({ requireSession: mockRequireSession }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/stellar/relayer", () => ({
  simulateReleaseByRelayer: mockSimulate,
  sendReleaseByRelayer: mockSend,
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: async (fn: (channel: unknown) => Promise<unknown>) => fn({ kind: "channel" }),
}));

import { POST as sessionRelease } from "@/app/api/deployments/[id]/release-early/route";
import { POST as v1Release } from "@/app/api/v1/deployments/[id]/release-early/route";
import { audit } from "@/lib/audit";
import { isSandboxAllowed } from "@/lib/sandbox-paths";
import { DEADLINE_PASSED_MESSAGE, NOTHING_TO_RELEASE_MESSAGE } from "@/lib/timelock-early-release";
import { ctx, newToken, request, tokenRow, DEPLOYMENT_ID } from "./v1/execute-fixtures";

const BRANCH_A = StrKey.encodeContract(Buffer.alloc(32, 21));
const BRANCH_B = StrKey.encodeContract(Buffer.alloc(32, 22));
const OWNER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", username: "owner", role: "USER" };
const DEP_ID = "11111111-1111-4111-8111-111111111111";
const TX_HASH = "ab".repeat(32);

const ONE_BRANCH = [
  { nodeId: "trigger", contractAddress: BRANCH_B, templateKind: "DEPOSIT_TRIGGER" },
  { nodeId: "tb-1", contractAddress: BRANCH_A, templateKind: "TIMELOCK_BRANCH" },
];
const TWO_BRANCHES = [
  { nodeId: "tb-1", contractAddress: BRANCH_A, templateKind: "TIMELOCK_BRANCH" },
  { nodeId: "tb-2", contractAddress: BRANCH_B, templateKind: "TIMELOCK_BRANCH" },
];

const contractError = (contract: string, code: number) =>
  `HostError: Error(Contract, #${code})\n` +
  `event: contract:${contract}, topics:[error, Error(Contract, #${code})], data:"escalating"`;

const simOk = { ok: true, latestLedger: 100, sim: { marker: "sim" } };
const sendOk = { status: "SUCCESS", txHash: TX_HASH, ledger: 101 };

function sessionCall(body?: unknown, rawBody?: string) {
  const req = new Request(`https://paiflow.test/api/deployments/${DEP_ID}/release-early`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? (body === undefined ? "" : JSON.stringify(body)),
  }) as unknown as NextRequest;
  return sessionRelease(req, { params: Promise.resolve({ id: DEP_ID }) });
}

function deployment(pipelineSnapshot: unknown, status = "CONFIRMED") {
  return { id: DEP_ID, status, pipelineSnapshot };
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

let n = 0;
let owner = OWNER;

beforeEach(() => {
  vi.clearAllMocks();
  // A fresh user per test, so each gets its own rate-limit bucket.
  n += 1;
  owner = { ...OWNER, id: `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString().padStart(12, "0")}` };
  mockRequireSession.mockResolvedValue(owner);
  mockSimulate.mockResolvedValue(simOk);
  mockSend.mockResolvedValue(sendOk);
});

describe("POST /api/deployments/:id/release-early (owner session)", () => {
  it("releases the before side, resolving the node from pipelineSnapshot", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    const res = await sessionCall();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { nodeId: "tb-1", txHash: TX_HASH, ledger: 101 } });
    // The lookup is scoped to the signed-in owner.
    expect(mockDb.deployment.findFirst.mock.calls[0]![0].where).toEqual({
      id: DEP_ID,
      ownerId: owner.id,
    });
    expect(mockSimulate).toHaveBeenCalledWith(BRANCH_A, "before");
    expect(mockSend).toHaveBeenCalledWith(BRANCH_A, simOk.sim, "before", { kind: "channel" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TIMELOCK_RELEASE_BEFORE",
        userId: owner.id,
        metadata: { deploymentId: DEP_ID, nodeId: "tb-1", txHash: TX_HASH },
      }),
    );
  });

  it("answers 404 for a deployment the caller does not own, and sends nothing", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(null);
    const res = await sessionCall();
    expect(res.status).toBe(404);
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("is refused without a session", async () => {
    const { AppError } = await import("@/lib/errors");
    mockRequireSession.mockRejectedValue(
      new AppError("UNAUTHENTICATED", "Authentication required"),
    );
    const res = await sessionCall();
    expect(res.status).toBe(401);
    expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
  });

  it("refuses several branches without a nodeId, and names them", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(TWO_BRANCHES));
    const res = await sessionCall();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toMatch(/nodeId.*tb-1, tb-2/);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("releases the chosen branch when several exist", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(TWO_BRANCHES));
    const res = await sessionCall({ nodeId: "tb-2" });
    expect(res.status).toBe(200);
    expect(mockSimulate).toHaveBeenCalledWith(BRANCH_B, "before");
  });

  it("refuses a nodeId that is not a timelock branch of this deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    const res = await sessionCall({ nodeId: "trigger" });
    expect(res.status).toBe(422);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("refuses a deployment with no timelock branch", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment([ONE_BRANCH[0]]));
    expect((await sessionCall()).status).toBe(422);
  });

  it("refuses an unconfirmed deployment", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH, "PENDING"));
    expect((await sessionCall()).status).toBe(422);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields and malformed JSON", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    expect((await sessionCall({ nodeId: "tb-1", side: "after" })).status).toBe(422);
    expect((await sessionCall(undefined, "{nope")).status).toBe(422);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("maps the contract's wrong-side refusal (ConditionNotMet) to a clear 422", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 100,
      error: contractError(BRANCH_A, 3),
    });
    const res = await sessionCall();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(DEADLINE_PASSED_MESSAGE);
    expect(mockSend).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("maps NothingToRelease to a clear 422", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 100,
      error: contractError(BRANCH_A, 4),
    });
    const res = await sessionCall();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(NOTHING_TO_RELEASE_MESSAGE);
  });

  it("does not read another contract's #3 as the deadline having passed", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 100,
      error: contractError(BRANCH_B, 3),
    });
    expect((await sessionCall()).status).toBe(502);
  });

  it("maps a deadline that slips by between probe and send to the same 422", async () => {
    const { AppError } = await import("@/lib/errors");
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSend.mockRejectedValue(
      new AppError(
        "UPSTREAM_RPC",
        `release_by_relayer simulation failed: ${contractError(BRANCH_A, 3)}`,
      ),
    );
    const res = await sessionCall();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(DEADLINE_PASSED_MESSAGE);
  });

  it("explains a send that failed on chain because the deadline passed after the probe", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSend.mockResolvedValue({ status: "FAILED", txHash: TX_HASH, errorMessage: "failed" });
    mockSimulate
      .mockResolvedValueOnce(simOk)
      .mockResolvedValueOnce({ ok: false, latestLedger: 102, error: contractError(BRANCH_A, 3) });
    const res = await sessionCall();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(DEADLINE_PASSED_MESSAGE);
    expect(audit).not.toHaveBeenCalled();
  });

  it("reports a relayer that cannot release this condition as a server-side error", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 100,
      error: contractError(BRANCH_A, 2),
    });
    expect((await sessionCall()).status).toBe(502);
  });

  it("reports a transaction that failed on the network, without auditing a release", async () => {
    mockDb.deployment.findFirst.mockResolvedValue(deployment(ONE_BRANCH));
    mockSend.mockResolvedValue({ status: "FAILED", txHash: TX_HASH, errorMessage: "boom" });
    expect((await sessionCall()).status).toBe(502);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/deployments/:id/release-early (deployment token)", () => {
  const PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/release-early`;
  let token: ReturnType<typeof newToken>;

  function authorize(pipelineSnapshot: unknown = ONE_BRANCH, deploymentOverrides = {}) {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(
      tokenRow(token, { pipelineSnapshot, ...deploymentOverrides }),
    );
  }

  const call = (body: unknown = {}, opts: { authorization?: string } = {}) =>
    v1Release(request(PATH, { token: token.plaintext, body, ...opts }), ctx());

  beforeEach(() => {
    token = newToken();
    mockDb.deploymentApiToken.update.mockResolvedValue({});
    authorize();
  });

  it("releases the before side with a valid token and audits it against the owner", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { nodeId: "tb-1", txHash: TX_HASH, ledger: 101 } });
    expect(mockSimulate).toHaveBeenCalledWith(BRANCH_A, "before");
    expect(mockSend).toHaveBeenCalledWith(BRANCH_A, simOk.sim, "before", { kind: "channel" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "API_TIMELOCK_RELEASE_BEFORE",
        metadata: expect.objectContaining({ tokenId: token.id, txHash: TX_HASH }),
      }),
    );
  });

  it("accepts an empty body when there is one branch", async () => {
    const res = await v1Release(request(PATH, { token: token.plaintext, rawBody: "" }), ctx());
    expect(res.status).toBe(200);
  });

  it("refuses a request with no token, a malformed one, or one for another deployment", async () => {
    expect((await v1Release(request(PATH, { body: {} }), ctx())).status).toBe(401);
    expect((await call({}, { authorization: "Bearer nope" })).status).toBe(401);
    mockDb.deploymentApiToken.findUnique.mockResolvedValue({
      ...tokenRow(token),
      deploymentId: "99999999-9999-4999-8999-999999999999",
    });
    expect((await call()).status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses a revoked token", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue({
      ...tokenRow(token),
      revokedAt: new Date(),
    });
    expect((await call()).status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses several branches without a nodeId", async () => {
    authorize(TWO_BRANCHES);
    const res = await call();
    expect(res.status).toBe(422);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("answers the deadline-passed 422 after the deadline", async () => {
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 100,
      error: contractError(BRANCH_A, 3),
    });
    const res = await call();
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(DEADLINE_PASSED_MESSAGE);
  });

  it("is rate limited per token", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call()).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe("sandbox exclusion", () => {
  it.each([
    `/api/deployments/${DEP_ID}/release-early`,
    `/api/v1/deployments/${DEP_ID}/release-early`,
  ])("keeps %s off the sandbox allowlist", (path) => {
    expect(isSandboxAllowed(path)).toBe(false);
  });
});
