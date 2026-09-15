/**
 * #468: the v1 execute pair. Prepare returns the unsigned deposit for a swapper
 * flow; submit refuses any envelope that is not exactly that deposit, then
 * sends, confirms, ingests and audits.
 *
 * Auth runs for real against a mocked token table, so every refusal below goes
 * through `requireDeploymentToken` and `v1Route` as a partner's request would.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  TransactionBuilder,
  Networks,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

const { mockDb, mockRpc, mockPrepareTriggerTx, mockBuildHint } = vi.hoisted(() => ({
  mockDb: { deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() } },
  mockRpc: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
  mockPrepareTriggerTx: vi.fn(),
  mockBuildHint: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
// No Redis: enforceRateLimit runs on its real in-memory bucket.
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mockRpc }));
vi.mock("@/lib/stellar/trigger", () => ({ prepareTriggerTx: mockPrepareTriggerTx }));
vi.mock("@/lib/stellar/pipeline-error-hint", () => ({ buildPipelineErrorHint: mockBuildHint }));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: vi.fn(async () => 1) }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  wasTxConfirmedFor: vi.fn(async () => false),
  wasTxSubmittedFor: vi.fn(async () => true),
}));

import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import { CONFIRM_POLL_INTERVAL_MS, ONLY_SWAPPER_FLOWS, waitForFinal } from "@/lib/api/v1/execute";
import { simulationFailure } from "@/lib/stellar/sim-error";
import { audit, wasTxConfirmedFor } from "@/lib/audit";
import { pollEventsFor } from "@/lib/stellar/events";
import {
  DEPLOYMENT_ID,
  OTHER_CONTRACT,
  OWNER_ID,
  PAYER,
  ROUTER,
  SWAPPER,
  TRIGGER,
  contractErrorEvent,
  ctx,
  newToken,
  request,
  signedEnvelope,
  tokenRow,
  txResult,
} from "./execute-fixtures";

const PREPARE_PATH = `/api/v1/deployments/${DEPLOYMENT_ID}/execute`;
const SUBMIT_PATH = `${PREPARE_PATH}/submit`;
const FROM = Keypair.random().publicKey();
const GENERIC_401 = "A valid API token for this deployment is required";

let token: ReturnType<typeof newToken>;

function authorize(
  deployment: Record<string, unknown> = {},
  owner?: { isActive: boolean; role: string },
) {
  mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow(token, deployment, owner));
}

const prepareBody = { amount: "10000000", from: FROM };

function callPrepare(body: unknown = prepareBody, opts: { authorization?: string } = {}) {
  return prepare(request(PREPARE_PATH, { token: token.plaintext, body, ...opts }), ctx());
}

function callSubmit(signedXdr: string, query = "") {
  return submit(
    request(`${SUBMIT_PATH}${query}`, { token: token.plaintext, body: { signedXdr } }),
    ctx(),
  );
}

const hashOf = (signed: string) =>
  (TransactionBuilder.fromXDR(signed, Networks.TESTNET) as Transaction).hash().toString("hex");

const auditActions = () => vi.mocked(audit).mock.calls.map(([a]) => a.action);

beforeEach(() => {
  vi.clearAllMocks();
  token = newToken();
  authorize();
  mockDb.deploymentApiToken.update.mockResolvedValue({});
  mockBuildHint.mockResolvedValue({ addressMap: { [ROUTER]: "soroswap_router" } });
  vi.mocked(wasTxConfirmedFor).mockResolvedValue(false);
});

describe("auth refusals (both routes)", () => {
  const routes = [
    [
      "prepare",
      (authorization?: string) =>
        prepare(request(PREPARE_PATH, { authorization, body: prepareBody }), ctx()),
    ],
    [
      "submit",
      (authorization?: string) =>
        submit(
          request(SUBMIT_PATH, { authorization, body: { signedXdr: signedEnvelope() } }),
          ctx(),
        ),
    ],
  ] as const;

  for (const [name, call] of routes) {
    describe(name, () => {
      it("401 with no bearer", async () => {
        const res = await call(undefined);
        expect(res.status).toBe(401);
        expect((await res.json()).error.message).toBe(GENERIC_401);
      });

      it("401 for a non-pfk token, before the database is asked", async () => {
        const res = await call("Bearer pkdev_abc");
        expect(res.status).toBe(401);
        expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
      });

      it("401 for an unknown token", async () => {
        mockDb.deploymentApiToken.findUnique.mockResolvedValue(null);
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(401);
      });

      it("401 for a revoked token", async () => {
        mockDb.deploymentApiToken.findUnique.mockResolvedValue({
          ...tokenRow(token),
          revokedAt: new Date(),
        });
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(401);
      });

      it("401 for an expired token", async () => {
        mockDb.deploymentApiToken.findUnique.mockResolvedValue({
          ...tokenRow(token),
          expiresAt: new Date(Date.now() - 1000),
        });
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(401);
      });

      it("401 for a token bound to another deployment", async () => {
        mockDb.deploymentApiToken.findUnique.mockResolvedValue({
          ...tokenRow(token),
          deploymentId: "22222222-2222-2222-2222-222222222222",
        });
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(401);
      });

      it("401 when the owner is deactivated", async () => {
        authorize({}, { isActive: false, role: "USER" });
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(401);
      });

      it("403 for a sandbox-owned deployment", async () => {
        authorize({}, { isActive: true, role: "SANDBOX" });
        expect((await call(`Bearer ${token.plaintext}`)).status).toBe(403);
      });
    });
  }

  it("404 for a malformed deployment id", async () => {
    const res = await prepare(
      request("/api/v1/deployments/nope/execute", { token: token.plaintext, body: prepareBody }),
      ctx("nope"),
    );
    expect(res.status).toBe(404);
  });

  it("429 once the token has spent 30 prepares in the window", async () => {
    mockPrepareTriggerTx.mockResolvedValue({ xdr: signedEnvelope() });
    for (let i = 0; i < 30; i++) expect((await callPrepare()).status).toBe(200);
    const res = await callPrepare();
    expect(res.status).toBe(429);
  });
});

describe("pipeline scope", () => {
  it("404 for a deployment that is not CONFIRMED", async () => {
    authorize({ status: "PENDING" });
    expect((await callPrepare()).status).toBe(404);
  });

  it.each([
    ["no pipeline", null],
    ["a splitter pipeline", [{ nodeId: "t", contractAddress: TRIGGER, templateKind: "SPLITTER" }]],
    [
      "a deposit trigger without a swapper",
      [
        { nodeId: "t", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
        { nodeId: "p", contractAddress: PAYER, templateKind: "PAYER" },
      ],
    ],
    [
      "a swapper behind a non-deposit head",
      [
        { nodeId: "w", contractAddress: TRIGGER, templateKind: "WEBHOOK" },
        { nodeId: "s", contractAddress: SWAPPER, templateKind: "SWAPPER" },
      ],
    ],
  ])("422 for %s, on both routes", async (_label, pipelineSnapshot) => {
    authorize({ pipelineSnapshot });
    const p = await callPrepare();
    expect(p.status).toBe(422);
    expect((await p.json()).error.message).toBe(ONLY_SWAPPER_FLOWS);

    const s = await callSubmit(signedEnvelope());
    expect(s.status).toBe(422);
    expect((await s.json()).error.message).toBe(ONLY_SWAPPER_FLOWS);
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("POST …/execute (prepare)", () => {
  it("returns the unsigned deposit, its passphrase, network and expiry, and audits it", async () => {
    const xdrOut = signedEnvelope();
    mockPrepareTriggerTx.mockResolvedValue({ xdr: xdrOut });

    const res = await callPrepare();

    expect(res.status).toBe(200);
    const maxTime = Number(
      (TransactionBuilder.fromXDR(xdrOut, Networks.TESTNET) as Transaction).timeBounds!.maxTime,
    );
    expect(await res.json()).toEqual({
      data: {
        xdr: xdrOut,
        networkPassphrase: Networks.TESTNET,
        network: "testnet",
        expiresAt: new Date(maxTime * 1000).toISOString(),
      },
    });
    expect(mockPrepareTriggerTx).toHaveBeenCalledWith({
      contractAddress: TRIGGER,
      amount: "10000000",
      fromAddress: FROM,
      isPipeline: true,
      hint: expect.any(Function),
    });
    // #436: the Soroswap hint is not paid on the success path.
    expect(mockBuildHint).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "API_EXECUTE_PREPARED",
        userId: OWNER_ID,
        metadata: {
          deploymentId: DEPLOYMENT_ID,
          tokenId: token.id,
          from: FROM,
          amount: "10000000",
        },
      }),
    );
  });

  it.each([
    ["a non-integer amount", { amount: "1.5", from: FROM }],
    ["a zero amount", { amount: "0", from: FROM }],
    ["a numeric amount", { amount: 10, from: FROM }],
    ["a contract as from", { amount: "1", from: TRIGGER }],
    ["an unknown field", { ...prepareBody, relayer: true }],
  ])("422 for %s", async (_label, body) => {
    const res = await callPrepare(body);
    expect(res.status).toBe(422);
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
  });

  it("422 for a body that is not JSON", async () => {
    const res = await prepare(
      request(PREPARE_PATH, { token: token.plaintext, rawBody: "{nope" }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });

  it("a simulation revert is a 422 with the friendly text and the prerequisites, hint built once", async () => {
    mockPrepareTriggerTx.mockImplementation(async (opts: { hint: () => Promise<unknown> }) => {
      const hint = (await opts.hint()) as Parameters<typeof simulationFailure>[1];
      throw simulationFailure(`contract:${ROUTER}, topics:[error, Error(Contract, #507)]`, hint);
    });

    const res = await callPrepare();

    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.message).toContain("Soroswap would return less than the minimum");
    expect(error.message).toContain("must be a funded account");
    expect(error.message).toContain("trustline");
    expect(mockBuildHint).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("402 when `from` does not exist on this network", async () => {
    mockPrepareTriggerTx.mockRejectedValue(new Error(`Account not found: ${FROM}`));
    const res = await callPrepare();
    expect(res.status).toBe(402);
    expect((await res.json()).error.message).toContain("must be a funded account");
  });

  it("502 when the RPC itself fails", async () => {
    mockPrepareTriggerTx.mockRejectedValue(new Error("socket hang up"));
    const res = await callPrepare();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_RPC");
  });
});

describe("POST …/execute/submit", () => {
  describe("envelope assertion", () => {
    it.each([
      ["another contract", () => signedEnvelope({ contract: OTHER_CONTRACT }), "trigger contract"],
      ["the swapper directly", () => signedEnvelope({ contract: SWAPPER }), "trigger contract"],
      ["a different function", () => signedEnvelope({ fn: "withdraw" }), "must call deposit"],
      ["two operations", () => signedEnvelope({ operations: 2 }), "exactly one operation"],
      ["garbage", () => "AAAAAAAAAAAAAAAAAAAA", "not a valid transaction envelope"],
    ])("refuses %s with 422, before the network is asked", async (_label, build, message) => {
      const res = await callSubmit(build());
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain(message);
      expect(mockRpc.getTransaction).not.toHaveBeenCalled();
      expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });

    it("refuses a fee-bump envelope", async () => {
      const inner = TransactionBuilder.fromXDR(signedEnvelope(), Networks.TESTNET) as Transaction;
      const bumper = Keypair.random();
      const bump = TransactionBuilder.buildFeeBumpTransaction(
        bumper,
        "1000",
        inner,
        Networks.TESTNET,
      );
      bump.sign(bumper);
      const res = await callSubmit(bump.toXDR());
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain("Fee-bump");
    });

    it("refuses a non-invoke operation", async () => {
      const kp = Keypair.random();
      const { Account, Operation, Asset } = await import("@stellar/stellar-sdk");
      const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({ destination: FROM, asset: Asset.native(), amount: "1" }))
        .setTimeout(180)
        .build();
      tx.sign(kp);
      const res = await callSubmit(tx.toXDR());
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain("must invoke a contract");
    });
  });

  it("sends, confirms, ingests and writes both audit rows", async () => {
    const signed = signedEnvelope();
    const txHash = hashOf(signed);
    mockRpc.getTransaction
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 4242 });
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

    const res = await callSubmit(signed);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { txHash, status: "SUCCESS", ledger: 4242 } });
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(pollEventsFor).toHaveBeenCalledWith(DEPLOYMENT_ID);
    expect(auditActions()).toEqual(["API_EXECUTE_SUBMITTED", "API_EXECUTE_CONFIRMED"]);
    expect(vi.mocked(audit).mock.calls[0]![0].metadata).toEqual({
      deploymentId: DEPLOYMENT_ID,
      tokenId: token.id,
      txHash,
    });
    expect(vi.mocked(audit).mock.calls[1]![0].metadata).toEqual({
      deploymentId: DEPLOYMENT_ID,
      tokenId: token.id,
      txHash,
      ledger: 4242,
    });
  });

  it("by default keeps polling while the sent transaction reads NOT_FOUND, until it is final", async () => {
    // Soroban RPC's getTransaction has no PENDING status: a sent transaction
    // that is not in a ledger yet reads NOT_FOUND.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const signed = signedEnvelope();
      const txHash = hashOf(signed);
      const notFound = { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
      mockRpc.getTransaction
        .mockResolvedValueOnce(notFound)
        .mockResolvedValueOnce(notFound)
        .mockResolvedValueOnce(notFound)
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 4243 });
      mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

      const pending = callSubmit(signed);
      await vi.advanceTimersByTimeAsync(2 * CONFIRM_POLL_INTERVAL_MS);
      const res = await pending;

      expect(await res.json()).toEqual({ data: { txHash, status: "SUCCESS", ledger: 4243 } });
      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(4);
      expect(auditActions()).toEqual(["API_EXECUTE_SUBMITTED", "API_EXECUTE_CONFIRMED"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wait=false returns PENDING right after sending, with only the submitted row", async () => {
    const signed = signedEnvelope();
    const txHash = hashOf(signed);
    mockRpc.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

    const res = await callSubmit(signed, "?wait=false");

    expect(await res.json()).toEqual({ data: { txHash, status: "PENDING" } });
    expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(["API_EXECUTE_SUBMITTED"]);
    expect(pollEventsFor).not.toHaveBeenCalled();
  });

  it("422 for a wait value that is not a boolean", async () => {
    expect((await callSubmit(signedEnvelope(), "?wait=maybe")).status).toBe(422);
  });

  it("is idempotent: a known, confirmed envelope is answered from the chain, not resent", async () => {
    const signed = signedEnvelope();
    const txHash = hashOf(signed);
    mockRpc.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      ledger: 99,
    });
    vi.mocked(wasTxConfirmedFor).mockResolvedValue(true);

    const res = await callSubmit(signed);

    expect(await res.json()).toEqual({ data: { txHash, status: "SUCCESS", ledger: 99 } });
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(pollEventsFor).not.toHaveBeenCalled();
  });

  it("records the confirmation once when a wait=false submission is resubmitted after it lands", async () => {
    const signed = signedEnvelope();
    mockRpc.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      ledger: 100,
    });

    await callSubmit(signed);

    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["API_EXECUTE_CONFIRMED"]);
    expect(pollEventsFor).toHaveBeenCalledTimes(1);
  });

  it("a DUPLICATE send (already in the queue) writes no second submitted row", async () => {
    const signed = signedEnvelope();
    mockRpc.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    mockRpc.sendTransaction.mockResolvedValue({ status: "DUPLICATE", hash: hashOf(signed) });

    const res = await callSubmit(signed, "?wait=false");

    expect((await res.json()).data.status).toBe("PENDING");
    expect(audit).not.toHaveBeenCalled();
  });

  it("a reverted swap reads as the Soroswap slippage message, never a bare code", async () => {
    const signed = signedEnvelope();
    mockRpc.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
      ledger: 7,
      resultXdr: txResult(xdr.TransactionResultResult.txFailed([])),
      // Emission order: the router originates, the swapper and trigger re-raise.
      diagnosticEventsXdr: [
        contractErrorEvent(ROUTER, 507),
        contractErrorEvent(SWAPPER, 507),
        contractErrorEvent(TRIGGER, 507),
      ],
    });

    const res = await callSubmit(signed);

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("FAILED");
    expect(data.ledger).toBe(7);
    expect(data.error.code).toBe("RouterInsufficientOutputAmount");
    expect(data.error.message).toContain("Soroswap would return less than the minimum");
    expect(data.error.message).not.toMatch(/#507/);
    expect(mockBuildHint).toHaveBeenCalledTimes(1);
  });

  it("an expired envelope rejected at send reads as expired", async () => {
    const signed = signedEnvelope();
    mockRpc.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    mockRpc.sendTransaction.mockResolvedValue({
      status: "ERROR",
      hash: hashOf(signed),
      errorResult: txResult(xdr.TransactionResultResult.txTooLate()),
    });

    const { data } = await (await callSubmit(signed)).json();

    expect(data.status).toBe("FAILED");
    expect(data.error).toEqual({
      code: "txTooLate",
      message: expect.stringContaining("180-second window expired"),
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("502 when the RPC throws", async () => {
    mockRpc.getTransaction.mockRejectedValue(new Error("ECONNRESET"));
    const res = await callSubmit(signedEnvelope());
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_RPC");
  });

  it("502 when the network asks to try again later", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    mockRpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: "x" });
    expect((await callSubmit(signedEnvelope())).status).toBe(502);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("waitForFinal", () => {
  it("stops at the deadline and hands back NOT_FOUND", async () => {
    mockRpc.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    const got = await waitForFinal("h", { deadlineMs: 30, intervalMs: 10 });
    expect(got.status).toBe(rpc.Api.GetTransactionStatus.NOT_FOUND);
    expect(mockRpc.getTransaction.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([rpc.Api.GetTransactionStatus.SUCCESS, rpc.Api.GetTransactionStatus.FAILED])(
    "polls through NOT_FOUND and returns %s once the transaction is final",
    async (status) => {
      const notFound = { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
      mockRpc.getTransaction
        .mockResolvedValueOnce(notFound)
        .mockResolvedValueOnce(notFound)
        .mockResolvedValueOnce({ status, ledger: 5 });
      const got = await waitForFinal("h", { deadlineMs: 1_000, intervalMs: 5 });
      expect(got.status).toBe(status);
      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(3);
    },
  );
});
