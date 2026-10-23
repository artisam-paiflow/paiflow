import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const m = vi.hoisted(() => ({
  deployment: vi.fn(),
  record: vi.fn(),
  audit: vi.fn(),
  beforeSend: vi.fn(),
  budgets: [] as unknown[],
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: m.deployment } } }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/audit", () => ({ audit: m.audit, needsSubmitRow: async () => true }));
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: m.record }));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(),
  recordTransactionOutcome: vi.fn(),
}));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: m.beforeSend,
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRelayerAddress: () => relayer,
  stellarRpcUrl: () => "https://rpc.invalid",
}));
vi.mock("@/lib/stellar/events", () => ({ pollEventsFor: vi.fn(), recordAllowanceEvent: vi.fn() }));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({ invalidateDashboardBalances: vi.fn() }));
import { GET, POST } from "@/app/api/deployments/[id]/subscription-allowance/route";
import { POST as submit } from "@/app/api/deployments/[id]/subscription-allowance/submit/route";
import { GET as status } from "@/app/api/deployments/[id]/subscription-allowance/status/route";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { interactiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { paymentAccountResponse } from "./payment-account-fixture";
import { ledgerFixture } from "./ledger-fixtures";

const id = "11111111-1111-4111-8111-111111111111";
const wallet = Keypair.random();
const relayer = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const token = StrKey.encodeContract(Buffer.alloc(32, 2));
const context = { params: Promise.resolve({ id }) };
let fault: string,
  delay: number,
  delayedStage: string,
  malformed: boolean,
  absent: boolean,
  cancelled: boolean;
let calls: string[], transactionReads: number, known: "NOT_FOUND" | "SUCCESS", sendLost: boolean;
function request(body?: unknown) {
  return new NextRequest(
    `https://paiflow.test/api/deployments/${id}/subscription-allowance`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
async function prepare() {
  const response = await POST(request({ amount: "200", userAddress: wallet.publicKey() }), context);
  expect(response.status).toBe(200);
  return (await response.json()).data as { xdr: string; intent: string; txHash: string };
}
function signed(prepared: { xdr: string; intent: string }) {
  const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET);
  tx.sign(wallet);
  return { signedXdr: tx.toXDR(), intent: prepared.intent };
}
function noSend() {
  expect(calls).not.toContain("sendTransaction");
  expect(m.record).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  fault = "";
  delay = 0;
  delayedStage = "";
  malformed = false;
  absent = false;
  cancelled = false;
  calls = [];
  transactionReads = 0;
  known = "NOT_FOUND";
  sendLost = false;
  m.budgets = [];
  m.deployment.mockResolvedValue({
    id,
    status: "CONFIRMED",
    network: "testnet",
    flow: { name: "Club", templateKind: "SUBSCRIPTION" },
    pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: contract }],
    graphSnapshot: {
      nodes: [
        {
          id: "sub",
          type: "subscription",
          config: {
            subscriber: wallet.publicKey(),
            asset: { kind: "native" },
            amountPerPeriodStroops: "100",
          },
        },
      ],
      edges: [],
    },
  });
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string);
      let stage = method;
      if (method === "simulateTransaction") {
        const operation = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET)
          .operations[0]!;
        if (operation.type !== "invokeHostFunction") throw new Error("unexpected operation");
        stage = operation.func.invokeContract().functionName().toString();
      }
      if (method === "getTransaction") transactionReads++;
      calls.push(stage);
      m.budgets.push(interactiveRpcBudget());
      if (delay && (!delayedStage || delayedStage === stage || delayedStage === method))
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          init.signal!.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(init.signal!.reason);
            },
            { once: true },
          );
        });
      if (
        fault === stage ||
        (fault === "status-second" && method === "getTransaction" && transactionReads === 2) ||
        (sendLost && method === "sendTransaction")
      )
        throw Object.assign(new Error("private provider URL and payload"), { code: "ECONNRESET" });
      let result: unknown;
      if (method === "getLedgerEntries") {
        const key = xdr.LedgerKey.fromXDR(params.keys[0], "base64");
        const address = Address.fromScAddress(
          xdr.ScAddress.scAddressTypeAccount(key.account().accountId()),
        ).toString();
        result = malformed
          ? { latestLedger: 1000, entries: null }
          : absent
            ? { latestLedger: 1000, entries: [] }
            : paymentAccountResponse(address);
      } else if (method === "getLatestLedger") result = ledgerFixture().latest;
      else if (method === "getLedgers") result = ledgerFixture().ledgers;
      else if (method === "getTransaction")
        result =
          known === "SUCCESS"
            ? { status: "SUCCESS", ledger: 1000, applicationOrder: 1, envelopeXdr: "malformed" }
            : {
                status: "NOT_FOUND",
                latestLedger: 1000,
                oldestLedger: 90,
                latestLedgerCloseTime: "1000",
                oldestLedgerCloseTime: "900",
              };
      else if (method === "sendTransaction")
        result = {
          status: "PENDING",
          hash: TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET)
            .hash()
            .toString("hex"),
          latestLedger: 1000,
          latestLedgerCloseTime: "1000",
        };
      else {
        const value =
          stage === "subscriber"
            ? new Address(wallet.publicKey()).toScVal()
            : stage === "asset"
              ? new Address(token).toScVal()
              : stage === "allowance"
                ? nativeToScVal(5n, { type: "i128" })
                : nativeToScVal(cancelled);
        result = {
          latestLedger: 1000,
          events: [],
          results: [{ auth: [], xdr: value.toXDR("base64") }],
          transactionData: new SorobanDataBuilder().build().toXDR("base64"),
          minResourceFee: "100",
        };
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("public Subscription allowance RPC reliability through the installed SDK", () => {
  it.each(["getLedgerEntries", "subscriber", "asset", "is_cancelled", "allowance"])(
    "classifies %s read failures without false funding guidance",
    async (stage) => {
      fault = stage;
      const response = await GET(request(), context);
      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatchObject({ code: "UPSTREAM_RPC" });
      noSend();
    },
  );
  it("distinguishes malformed account data from a successful empty response", async () => {
    malformed = true;
    expect((await GET(request(), context)).status).toBe(502);
    malformed = false;
    absent = true;
    expect((await GET(request(), context)).status).toBe(402);
  });
  it("allows successful 11-second simulations within one 25-second read budget", async () => {
    delay = 11000;
    delayedStage = "simulateTransaction";
    const response = GET(request(), context);
    await vi.advanceTimersByTimeAsync(22001);
    expect((await response).status).toBe(200);
    expect(new Set(m.budgets).size).toBe(1);
    expect(m.budgets[0]).toBeDefined();
  });
  it("bounds aggregate state and allowance work and closes pending HTTP work", async () => {
    delay = 7000;
    const response = GET(request(), context);
    await vi.advanceTimersByTimeAsync(25001);
    expect((await response).status).toBe(502);
    noSend();
  });
  it.each(["getLatestLedger", "approve"])(
    "does not expose approval preparation after %s transport failure",
    async (stage) => {
      fault = stage;
      const response = await POST(
        request({ amount: "200", userAddress: wallet.publicKey() }),
        context,
      );
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("private provider");
      noSend();
    },
  );
  it("shares the preparation budget through configuration, allowance, ledger and approval simulation", async () => {
    const prepared = await prepare();
    expect(prepared.txHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(m.budgets).size).toBe(1);
    expect(calls).toContain("approve");
    noSend();
  });
  it.each(["getLedgerEntries", "subscriber", "getTransaction"])(
    "retains original identity without sending when submit %s eligibility is unavailable",
    async (stage) => {
      const prepared = await prepare();
      const body = signed(prepared);
      m.budgets = [];
      fault = stage;
      const response = await submit(request(body), context);
      expect(response.status).toBe(502);
      noSend();
    },
  );
  it("closes the eligibility budget before durable writes and uncertain send; retries the same envelope", async () => {
    const prepared = await prepare();
    const body = signed(prepared);
    m.budgets = [];
    calls = [];
    sendLost = true;
    m.record.mockImplementation(async () => {
      expect(interactiveRpcBudget()).toBeUndefined();
    });
    const response = await submit(request(body), context);
    expect(response.status).toBe(502);
    expect(calls.filter((stage) => stage === "sendTransaction")).toHaveLength(1);
    expect(m.budgets.at(-1)).toBeUndefined();
    sendLost = false;
    const retry = await submit(request(body), context);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.txHash).toBe(prepared.txHash);
  });
  it.each(["getTransaction", "status-second"])(
    "keeps finality unknown and sanitizes %s status failure",
    async (stage) => {
      const prepared = await prepare();
      fault = stage;
      m.budgets = [];
      const response = await status(
        new NextRequest(
          `https://paiflow.test/api/deployments/${id}/subscription-allowance/status?intent=${encodeURIComponent(prepared.intent)}`,
        ),
        context,
      );
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("private provider");
      expect(new Set(m.budgets).size).toBe(1);
      expect(transactionReads).toBe(stage === "status-second" ? 2 : 1);
      noSend();
    },
  );
});

describe("public allowance aggregate deadlines", () => {
  it("stops preparation before returning an intent when the shared budget expires", async () => {
    delay = 4000;
    const response = POST(request({ amount: "200", userAddress: wallet.publicKey() }), context);
    await vi.advanceTimersByTimeAsync(25001);
    const result = await response;
    expect(result.status).toBe(502);
    expect((await result.json()).data).toBeUndefined();
    noSend();
  });
  it("does not record or send when submit eligibility exhausts its aggregate deadline", async () => {
    const prepared = await prepare();
    const body = signed(prepared);
    delay = 9000;
    const response = submit(request(body), context);
    await vi.advanceTimersByTimeAsync(25001);
    expect((await response).status).toBe(502);
    noSend();
  });
  it("retains unknown finality when aggregate status work exhausts its deadline", async () => {
    const prepared = await prepare();
    delay = 9000;
    const response = status(
      new NextRequest(
        `https://paiflow.test/api/deployments/${id}/subscription-allowance/status?intent=${encodeURIComponent(prepared.intent)}`,
      ),
      context,
    );
    await vi.advanceTimersByTimeAsync(25001);
    expect((await response).status).toBe(502);
    noSend();
  });
  it("bounds send dispatch independently after eligibility and retains the original approval", async () => {
    const prepared = await prepare();
    const body = signed(prepared);
    delay = 11000;
    delayedStage = "sendTransaction";
    const response = submit(request(body), context);
    await vi.advanceTimersByTimeAsync(10001);
    const result = await response;
    expect(result.status).toBe(502);
    expect((await result.json()).error.message).toContain("outcome is unknown");
    expect(calls.filter((stage) => stage === "sendTransaction")).toHaveLength(1);
  });
});

describe("approval builder failures preserve account and contract distinctions", () => {
  const approval = {
    tokenContractAddress: token,
    from: wallet.publicKey(),
    spender: contract,
    amount: "200",
  };
  it.each(["getLedgerEntries", "getLatestLedger", "approve"])(
    "sanitizes %s transport failure",
    async (stage) => {
      fault = stage;
      await expect(
        withInteractiveRpcBudget(() => prepareTokenApproveInvocation(approval)),
      ).rejects.toMatchObject({ code: "UPSTREAM_RPC", details: undefined });
      noSend();
    },
  );
  it("keeps genuine wallet absence as insufficient funds", async () => {
    absent = true;
    await expect(
      withInteractiveRpcBudget(() => prepareTokenApproveInvocation(approval)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });
  it("refuses malformed wallet responses as upstream failures", async () => {
    malformed = true;
    await expect(
      withInteractiveRpcBudget(() => prepareTokenApproveInvocation(approval)),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
  it("preserves actual contract simulation errors", async () => {
    const transport = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init: RequestInit) => {
        const payload = JSON.parse(init.body as string);
        if (payload.method === "simulateTransaction")
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { latestLedger: 1000, error: "Error(Contract, #1)", events: [] },
          });
        return transport(url, init);
      }),
    );
    await expect(
      withInteractiveRpcBudget(() => prepareTokenApproveInvocation(approval)),
    ).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
      details: expect.stringContaining("Error(Contract, #1)"),
    });
  });
  it("refuses malformed simulation responses without exposing SDK/provider payloads", async () => {
    const transport = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init: RequestInit) => {
        const payload = JSON.parse(init.body as string);
        if (payload.method === "simulateTransaction")
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { latestLedger: 1000, results: [{ auth: [], xdr: "invalid" }] },
          });
        return transport(url, init);
      }),
    );
    await expect(
      withInteractiveRpcBudget(() => prepareTokenApproveInvocation(approval)),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC", details: undefined });
  });
});
