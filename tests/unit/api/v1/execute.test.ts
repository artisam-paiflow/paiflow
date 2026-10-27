// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
vi.mock("@/lib/analytics/outcomes", () => ({
  recordTransactionOutcome: vi.fn(async () => false),
  beginTransactionSubmission: vi.fn(async () => undefined),
  transactionObservation: vi.fn(async () => undefined),
}));
/**
 * #468: the v1 execute pair. Prepare returns the unsigned deposit for a swapper
 * flow; submit refuses any envelope that is not exactly that deposit, then
 * sends, confirms, ingests and audits.
 *
 * Auth runs for real against a mocked token table, so every refusal below goes
 * through `requireDeploymentToken` and `v1Route` as a partner's request would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: vi.fn(async () => undefined) }));

import { interactiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { POST as prepare } from "@/app/api/v1/deployments/[id]/execute/route";
import { POST as submit } from "@/app/api/v1/deployments/[id]/execute/submit/route";
import {
  CONFIRM_POLL_INTERVAL_MS,
  NOT_EXECUTABLE_FLOW,
  explainFailedTx,
  waitForFinal,
} from "@/lib/api/v1/execute";
import { V1_WAIT_SLOTS } from "@/lib/api/v1/limits";
import { acquireWaitSlot } from "@/lib/api/v1/wait-slots";
import { AppError } from "@/lib/errors";
import { I128_MAX } from "@/lib/flows/primitives";
import { SimulationError, simulationFailure } from "@/lib/stellar/sim-error";
import { MissingPaymentAccountError } from "@/lib/stellar/load-payment-account";
import { audit, wasTxConfirmedFor } from "@/lib/audit";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { pollEventsFor } from "@/lib/stellar/events";
import {
  DEPLOYMENT_ID,
  OTHER_CONTRACT,
  OWNER_ID,
  PAYER,
  ROUTER,
  SWAPPER_PIPELINE,
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
    ["no pipeline", null, NOT_EXECUTABLE_FLOW],
    ["an empty pipeline", [], NOT_EXECUTABLE_FLOW],
    [
      "a splitter head",
      [{ nodeId: "t", contractAddress: TRIGGER, templateKind: "SPLITTER" }],
      "starts with a splitter step",
    ],
    [
      "a swapper behind a webhook head",
      [
        { nodeId: "w", contractAddress: TRIGGER, templateKind: "WEBHOOK" },
        { nodeId: "s", contractAddress: SWAPPER, templateKind: "SWAPPER" },
      ],
      "starts with a webhook step",
    ],
    [
      "a subscription head",
      [
        { nodeId: "s", contractAddress: TRIGGER, templateKind: "SUBSCRIPTION" },
        { nodeId: "p", contractAddress: PAYER, templateKind: "PAYER" },
      ],
      "starts with a subscription step",
    ],
    [
      "a dev subscription head",
      [{ nodeId: "s", contractAddress: TRIGGER, templateKind: "SUBSCRIPTION_DEV" }],
      "starts with a subscription step",
    ],
    [
      "a payroll head",
      [{ nodeId: "s", contractAddress: TRIGGER, templateKind: "PAYROLL" }],
      "starts with a payroll step",
    ],
    [
      "a head kind this release has never heard of",
      [{ nodeId: "s", contractAddress: TRIGGER, templateKind: "FUTURE_KIND" }],
      "starts with a FUTURE_KIND step",
    ],
    [
      "a deposit trigger head with no address",
      [{ nodeId: "t", contractAddress: "", templateKind: "DEPOSIT_TRIGGER" }],
      NOT_EXECUTABLE_FLOW,
    ],
  ])("422 for %s, on both routes", async (_label, pipelineSnapshot, expected) => {
    authorize({ pipelineSnapshot });
    const p = await callPrepare();
    expect(p.status).toBe(422);
    expect((await p.json()).error.message).toContain(expected);

    const s = await callSubmit(signedEnvelope());
    expect(s.status).toBe(422);
    expect((await s.json()).error.message).toContain(expected);
    expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  // #756: every flow that starts with a deposit trigger is executable, not only swappers.
  it.each([
    [
      "a Pay flow",
      [
        { nodeId: "t", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
        { nodeId: "p", contractAddress: PAYER, templateKind: "PAYER" },
      ],
    ],
    [
      "a Split flow",
      [
        { nodeId: "t", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
        { nodeId: "s", contractAddress: OTHER_CONTRACT, templateKind: "SPLITTER" },
      ],
    ],
    [
      "an amount-condition flow",
      [
        { nodeId: "t", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
        { nodeId: "r", contractAddress: OTHER_CONTRACT, templateKind: "ROUTER" },
        { nodeId: "p", contractAddress: PAYER, templateKind: "PAYER" },
        { nodeId: "s", contractAddress: SWAPPER, templateKind: "PAYER_DEV" },
      ],
    ],
    ["a swap flow", SWAPPER_PIPELINE],
  ])("prepares and submits %s through its trigger", async (_label, pipelineSnapshot) => {
    authorize({ pipelineSnapshot });
    const signed = signedEnvelope();
    mockPrepareTriggerTx.mockResolvedValue({ xdr: signed });

    const p = await callPrepare();
    expect(p.status).toBe(200);
    expect(mockPrepareTriggerTx).toHaveBeenCalledWith(
      expect.objectContaining({ contractAddress: TRIGGER, isPipeline: true }),
    );

    // The envelope check is the same for every head: only a deposit on this trigger.
    const wrong = await callSubmit(signedEnvelope({ contract: OTHER_CONTRACT }));
    expect(wrong.status).toBe(422);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("a Pay or Split step with nothing configured (#756)", () => {
  const DEV_PIPELINE = (kind: "PAYER_DEV" | "SPLITTER_DEV") => [
    { nodeId: "t", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
    { nodeId: "p", contractAddress: PAYER, templateKind: kind },
  ];

  it.each([
    [
      "PAYER_DEV",
      "payer_dev",
      "This flow's Pay step has no recipient yet. Set it in Dev values on the deployment page, or per payment through POST /api/v1/deployments/:id/payouts.",
    ],
    [
      "SPLITTER_DEV",
      "splitter_dev",
      "This flow's Split step has no recipients yet. Set them in Dev values on the deployment page.",
    ],
  ] as const)("%s NotConfigured is a plain 422 on prepare", async (kind, key, text) => {
    authorize({ pipelineSnapshot: DEV_PIPELINE(kind) });
    mockBuildHint.mockResolvedValue({ addressMap: { [TRIGGER]: "deposit_trigger", [PAYER]: key } });
    mockPrepareTriggerTx.mockImplementation(async (opts: { hint: () => Promise<unknown> }) => {
      const hint = (await opts.hint()) as Parameters<typeof simulationFailure>[1];
      // payer_dev NotConfigured is #4; splitter_dev's is #8.
      const code = kind === "PAYER_DEV" ? 4 : 8;
      throw simulationFailure(`contract:${PAYER}, topics:[error, Error(Contract, #${code})]`, hint);
    });

    const res = await callPrepare();

    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.message).toContain(text);
    if (kind === "SPLITTER_DEV") {
      expect(error.message).not.toContain("/payouts");
    }
  });

  it("is a plain message on a reverted submit too", async () => {
    mockBuildHint.mockResolvedValue({ addressMap: { [PAYER]: "payer_dev" } });
    const failure = await explainFailedTx(
      { diagnosticEventsXdr: [contractErrorEvent(PAYER, 4)] },
      DEV_PIPELINE("PAYER_DEV"),
    );
    expect(failure.code).toBe("NotConfigured");
    expect(failure.message).toBe(
      "This flow's Pay step has no recipient yet. Set it in Dev values on the deployment page, or per payment through POST /api/v1/deployments/:id/payouts.",
    );
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
          tokenType: "deployment_token",
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

  it.each([(I128_MAX + 1n).toString(), "9".repeat(39)])(
    "rejects an overflowing amount with 422 before preparation or financial side effects: %s",
    async (amount) => {
      const res = await callPrepare({ ...prepareBody, amount });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: {
          code: "VALIDATION",
          fields: { amount: ["Amount exceeds the contract i128 range"] },
        },
      });
      expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
      expect(mockBuildHint).not.toHaveBeenCalled();
      expect(mockRpc.getTransaction).not.toHaveBeenCalled();
      expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
      expect(recordSignedTransaction).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it.each([(I128_MAX - 1n).toString(), I128_MAX.toString()])(
    "passes a representable boundary amount unchanged to preparation: %s",
    async (amount) => {
      mockPrepareTriggerTx.mockResolvedValue({ xdr: signedEnvelope() });

      const res = await callPrepare({ ...prepareBody, amount });

      expect(res.status).toBe(200);
      expect(mockPrepareTriggerTx).toHaveBeenCalledWith(expect.objectContaining({ amount }));
    },
  );

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

  // #553: QA could not exercise these (TC-012), and the branch used to be
  // chosen by the prefix of `details`.
  it.each([
    [
      "a payout recipient without the trustline (an asset contract's #13)",
      "contract:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA, topics:[error, Error(Contract, #13)]",
    ],
    [
      "a pair with no Soroswap pool (the factory's #205)",
      "contract:CDGXPBJPUBLIB4IMEIJXWUJXBLHVK6X33UAHIVLXPHMEGYCHZWLYBLQY, topics:[error, Error(Contract, #205)]",
    ],
  ])("%s is a 422 with the prerequisites, not a 502", async (_, raw) => {
    mockPrepareTriggerTx.mockImplementation(async () => {
      throw simulationFailure(raw);
    });
    const res = await callPrepare();
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("must be a funded account");
  });

  it("keeps a VALIDATION-coded simulation rejection at 422 with details and prerequisites", async () => {
    const details = "Soroban simulate failed: Error(Contract, #13)";
    const message = `The sender (${FROM}) has no trustline for USDC.`;
    mockPrepareTriggerTx.mockRejectedValue(
      new SimulationError("VALIDATION", message, undefined, details),
    );
    const res = await callPrepare();
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain(message);
    expect(error.message).toContain("must be a funded account");
    expect(error.details).toBe(details);
  });

  it("classifies by the error's class, not the wording of its details", async () => {
    mockPrepareTriggerTx.mockImplementation(async () => {
      throw new SimulationError("UPSTREAM_RPC", "reverted", undefined, "any wording at all");
    });
    expect((await callPrepare()).status).toBe(422);

    mockPrepareTriggerTx.mockImplementation(async () => {
      throw new AppError("UPSTREAM_RPC", "down", undefined, "Soroban simulate failed: look-alike");
    });
    expect((await callPrepare()).status).toBe(502);
  });

  it("402 when `from` does not exist on this network", async () => {
    mockPrepareTriggerTx.mockRejectedValue(new MissingPaymentAccountError());
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

  it("does not infer a missing account from the SDK's catch-all error message", async () => {
    mockPrepareTriggerTx.mockRejectedValue(new Error(`Account not found: ${FROM}`));
    const res = await callPrepare();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_RPC");
  });
});

describe("partner inbound amount admission (#876)", () => {
  const fixedPay = (id: string, amountStroops: string) => ({
    id,
    type: "pay",
    config: {
      recipient: FROM,
      asset: { kind: "native" },
      mode: "fixed",
      amountStroops,
      fullAmount: false,
    },
  });
  const fixedSplit = {
    id: "s",
    type: "split",
    config: {
      asset: { kind: "native" },
      recipients: [{ address: FROM, mode: "fixed", amountStroops: "2500000" }],
    },
  };
  function setGraph(actions: object[]) {
    const nodes = [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      ...actions,
    ];
    authorize({
      graphSnapshot: {
        nodes,
        edges: nodes.slice(1).map((node, i) => ({
          id: `e${i}`,
          source: (nodes[i] as { id: string }).id,
          target: (node as { id: string }).id,
        })),
      },
    });
    mockPrepareTriggerTx.mockResolvedValue({ xdr: signedEnvelope() });
  }

  it.each(["2499999", "2500001"])(
    "rejects terminal fixed Pay %s before preparation",
    async (amount) => {
      setGraph([fixedPay("p", "2500000")]);
      const response = await callPrepare({ ...prepareBody, amount });
      expect(response.status).toBe(422);
      const { error } = await response.json();
      expect(error.code).toBe("VALIDATION");
      expect(error.message).toContain("exactly 0.25 XLM");
      expect(error.fields.amount).toEqual(["Must be 0.25 XLM"]);
      expect(mockPrepareTriggerTx).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it("prepares the exact terminal fixed Pay amount", async () => {
    setGraph([fixedPay("p", "2500000")]);
    expect((await callPrepare({ ...prepareBody, amount: "2500000" })).status).toBe(200);
    expect(mockPrepareTriggerTx).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "2500000" }),
    );
  });

  it.each(["4999999", "5000000", "5000001"])(
    "bounds fixed Pay chains at their sum: %s",
    async (amount) => {
      setGraph([fixedPay("p", "2500000"), fixedPay("q", "2500000")]);
      expect((await callPrepare({ ...prepareBody, amount })).status).toBe(
        amount === "5000000" ? 200 : 422,
      );
    },
  );

  it.each(["1000000", "2500000", "2500001"])(
    "preserves fixed Split batch/residual input %s",
    async (amount) => {
      setGraph([fixedSplit]);
      expect((await callPrepare({ ...prepareBody, amount })).status).toBe(200);
    },
  );

  it.each(["2499999", "2500000", "2500001"])(
    "retains a fixed Pay floor before Split: %s",
    async (amount) => {
      setGraph([fixedPay("p", "2500000"), fixedSplit]);
      expect((await callPrepare({ ...prepareBody, amount })).status).toBe(
        amount === "2499999" ? 422 : 200,
      );
    },
  );

  it.each(["1", "2500001"])("preserves percentage Split input %s", async (amount) => {
    setGraph([
      {
        id: "s",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [{ address: FROM, mode: "percentage", bps: 10000 }],
        },
      },
    ]);
    expect((await callPrepare({ ...prepareBody, amount })).status).toBe(200);
  });

  it.each(["1", "2500001"])("preserves percentage Pay input %s", async (amount) => {
    setGraph([
      {
        id: "p",
        type: "pay",
        config: {
          recipient: FROM,
          asset: { kind: "native" },
          mode: "percentage",
          percentage: 50,
          fullAmount: false,
        },
      },
    ]);
    expect((await callPrepare({ ...prepareBody, amount })).status).toBe(200);
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
    const signer = Keypair.random();
    const signed = signedEnvelope({ signer });
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
      tokenType: "deployment_token",
      txHash,
      signerAddress: signer.publicKey(),
    });
    expect(vi.mocked(audit).mock.calls[1]![0].metadata).toEqual({
      deploymentId: DEPLOYMENT_ID,
      tokenId: token.id,
      tokenType: "deployment_token",
      txHash,
      signerAddress: signer.publicKey(),
      ledger: 4242,
    });
    // The signer is the partner's key, recorded with no app user attached.
    expect(vi.mocked(recordSignedTransaction)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "API_EXECUTE",
        userId: null,
        deploymentId: DEPLOYMENT_ID,
        signer: expect.objectContaining({ ok: true, signerAddress: signer.publicKey(), txHash }),
      }),
    );
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

  describe("concurrent wait=true cap (#524)", () => {
    async function holdAllSlots() {
      const held = [];
      for (let i = 0; i < V1_WAIT_SLOTS.perToken; i++) {
        const slot = await acquireWaitSlot(token.id);
        expect(slot).not.toBeNull();
        held.push(slot!);
      }
      return held;
    }

    async function expectNoSlotLeaked() {
      const held = await holdAllSlots();
      await Promise.all(held.map((s) => s.release()));
    }

    it("over the cap, still sends and answers PENDING at once instead of waiting", async () => {
      const held = await holdAllSlots();
      try {
        const signed = signedEnvelope();
        const txHash = hashOf(signed);
        mockRpc.getTransaction.mockResolvedValue({
          status: rpc.Api.GetTransactionStatus.NOT_FOUND,
        });
        mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

        const res = await callSubmit(signed);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { txHash, status: "PENDING" } });
        expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
        // Only the pre-send lookup: no polling.
        expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1);
        expect(auditActions()).toEqual(["API_EXECUTE_SUBMITTED"]);
      } finally {
        await Promise.all(held.map((s) => s.release()));
      }
    });

    it("the cap is per token: another token still waits", async () => {
      const held = await holdAllSlots();
      try {
        token = newToken();
        authorize();
        const signed = signedEnvelope();
        const txHash = hashOf(signed);
        mockRpc.getTransaction
          .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
          .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 7 });
        mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });

        expect(await (await callSubmit(signed)).json()).toEqual({
          data: { txHash, status: "SUCCESS", ledger: 7 },
        });
      } finally {
        await Promise.all(held.map((s) => s.release()));
      }
    });

    it("releases the slot when the wait completes", async () => {
      const signed = signedEnvelope();
      mockRpc.getTransaction
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 8 });
      mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: hashOf(signed) });

      expect((await callSubmit(signed)).status).toBe(200);
      await expectNoSlotLeaked();
    });

    it("releases the slot when the wait fails", async () => {
      const signed = signedEnvelope();
      mockRpc.getTransaction
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
        .mockRejectedValueOnce(new Error("ECONNRESET"));
      mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: hashOf(signed) });

      expect((await callSubmit(signed)).status).toBe(502);
      await expectNoSlotLeaked();
    });
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

describe("shared interactive submit budget", () => {
  function rpcAfter<T>(value: T, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = interactiveRpcBudget()?.signal;
      const timer = setTimeout(() => resolve(value), ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    mockRpc.getTransaction.mockReset();
    mockRpc.sendTransaction.mockReset();
    vi.mocked(pollEventsFor).mockReset().mockResolvedValue(1);
  });

  it("shares25 seconds across preflight, send and optional confirmation, returning accepted PENDING", async () => {
    const signed = signedEnvelope(),
      txHash = hashOf(signed);
    mockRpc.getTransaction
      .mockImplementationOnce(() => rpcAfter({ status: "NOT_FOUND" }, 8_000))
      .mockImplementation(() => rpcAfter({ status: "NOT_FOUND" }, 50_000));
    mockRpc.sendTransaction.mockImplementation(() =>
      rpcAfter({ status: "PENDING", hash: txHash }, 8_000),
    );
    const start = Date.now(),
      pending = callSubmit(signed);
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await pending;
    expect(Date.now() - start).toBe(25_000);
    expect(await response.json()).toEqual({ data: { txHash, status: "PENDING" } });
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockRpc.getTransaction).toHaveBeenCalledTimes(2);
    expect(recordTransactionOutcome).toHaveBeenCalledWith(txHash, "ACCEPTED", expect.any(Object));
    expect(
      vi
        .mocked(recordTransactionOutcome)
        .mock.calls.some(([, outcome]) => outcome === "UNRESOLVED"),
    ).toBe(false);
  });

  it("retains the original hash as UNRESOLVED when send exhausts the remaining budget and never resends", async () => {
    const signed = signedEnvelope(),
      txHash = hashOf(signed);
    mockRpc.getTransaction.mockImplementation(() => rpcAfter({ status: "NOT_FOUND" }, 8_000));
    mockRpc.sendTransaction.mockImplementation(() =>
      rpcAfter({ status: "PENDING", hash: txHash }, 50_000),
    );
    const pending = callSubmit(signed);
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await pending,
      body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_RPC");
    expect(body.error.message).toContain(txHash);
    expect(body.error.message).toContain("outcome is unknown");
    expect(recordSignedTransaction).toHaveBeenCalledOnce();
    expect(recordTransactionOutcome).toHaveBeenCalledWith(txHash, "UNRESOLVED", expect.any(Object));
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1);
    expect(pollEventsFor).not.toHaveBeenCalled();
  });

  it("persists known SUCCESS even when the last second is exhausted catching up events", async () => {
    const signed = signedEnvelope(),
      txHash = hashOf(signed);
    mockRpc.getTransaction.mockImplementation(() =>
      rpcAfter({ status: "SUCCESS", ledger: 4242 }, 24_000),
    );
    vi.mocked(pollEventsFor).mockImplementation(() => rpcAfter(1, 50_000));
    const pending = callSubmit(signed);
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await pending;
    expect(await response.json()).toEqual({ data: { txHash, status: "SUCCESS", ledger: 4242 } });
    expect(recordTransactionOutcome).toHaveBeenCalledWith(
      txHash,
      "CONFIRMED",
      expect.objectContaining({ ledger: 4242 }),
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(pollEventsFor).toHaveBeenCalledOnce();
  });
});
