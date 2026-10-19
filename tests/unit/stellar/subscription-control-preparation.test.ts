import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "@prisma/client";
import type { NextRequest } from "next/server";
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  relayerAddress: vi.fn(),
  latest: vi.fn(),
  createIntent: vi.fn(),
  deployment: vi.fn(),
  audit: vi.fn(),
  charge: vi.fn(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarRelayerAddress: () => mocks.relayerAddress(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findFirst: mocks.deployment },
    auditLog: { create: mocks.audit },
    subscriptionCharge: { create: mocks.charge },
  },
}));
vi.mock("@/lib/deployments/service-work", () => ({
  beforeServiceSubmission: vi.fn(),
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "127.0.0.1",
  enforceRateLimit: async () => undefined,
}));
vi.mock("@/lib/subscription/state", () => ({ readSubscriptionState: mocks.state }));
vi.mock("@/lib/api/v1/control-intent", () => ({
  createControlIntent: mocks.createIntent,
  readControlIntent: vi.fn(),
}));
vi.mock("@/lib/api/v1/control-submission", () => ({ submitControlIntent: vi.fn() }));
vi.mock("@/lib/api/request-history/context", () => ({ linkApiTransaction: vi.fn() }));

import { prepareSubscriptionControl } from "@/lib/api/v1/subscription-controls";
import { POST as ownerReactivate } from "@/app/api/deployments/[id]/subscription-subscribe/route";
import { POST as ownerCancel } from "@/app/api/deployments/[id]/subscription-unsubscribe/route";
import { AppError } from "@/lib/errors";
import { sorobanRpc, STELLAR_HTTP_TIMEOUT_MS } from "@/lib/stellar/client";
import {
  interactiveRpcBudget,
  remainingInteractiveRpcMs,
  withInteractiveRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { SimulationError } from "@/lib/stellar/sim-error";
import { paymentAccountResponse } from "./payment-account-fixture";

const wallet = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "CONFIRMED",
  network: "testnet",
  webhookSecret: null,
  flow: { templateKind: "SUBSCRIPTION" },
  pipelineSnapshot: [{ nodeId: "sub", templateKind: "SUBSCRIPTION", contractAddress: contract }],
  graphSnapshot: {
    nodes: [
      {
        id: "sub",
        type: "subscription",
        config: {
          subscriber: wallet,
          asset: { kind: "native" },
          amountPerPeriodStroops: "100",
        },
      },
    ],
    edges: [],
  },
} as unknown as Deployment;
const state = {
  subscriber: wallet,
  isCancelled: true,
  network: "testnet",
  templateKind: "SUBSCRIPTION",
  contractAddress: contract,
  tokenContractAddress: asset,
};
const success = () => ({
  latestLedger: 1000,
  minResourceFee: "1000",
  transactionData: new SorobanDataBuilder().build().toXDR("base64"),
  results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
  events: [],
});
type RpcCall = { method: string; params?: unknown };
function rpcFetch(handle: (call: RpcCall, init: RequestInit) => Promise<unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const result = await handle(JSON.parse(init.body as string), init);
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
}
function normal(call: RpcCall) {
  if (call.method === "getLatestLedger") return { sequence: 1000 };
  if (call.method === "getLedgerEntries") return paymentAccountResponse(wallet);
  if (call.method === "simulateTransaction") return success();
  throw new Error(`Unexpected RPC mutation: ${call.method}`);
}
function stalled(init: RequestInit) {
  return new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });
}
function prepare() {
  return prepareSubscriptionControl(deployment, "subscription.reactivate", wallet);
}
function unchanged() {
  expect(mocks.createIntent).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.charge).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockImplementation(async () => {
    await mocks.latest();
    return { sequence: 1000 } as Awaited<ReturnType<rpc.Server["getLatestLedger"]>>;
  });
  mocks.latest.mockResolvedValue(undefined);
  mocks.relayerAddress.mockReturnValue(undefined);
  mocks.state.mockResolvedValue(state);
  mocks.deployment.mockResolvedValue(deployment);
  mocks.createIntent.mockResolvedValue({ intent: "intent", txHash: "a".repeat(64) });
  rpcFetch(async (call) => normal(call));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Subscription preparation through the real SDK client and builders", () => {
  it.each(["getLedgerEntries", "simulateTransaction"])(
    "classifies a %s timeout as upstream without reserving an intent or changing billing",
    async (method) => {
      rpcFetch(async (call, init) => (call.method === method ? stalled(init) : normal(call)));
      const result = prepare();
      const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      unchanged();
      const calls = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(call[1]!.body as string));
      expect(calls.filter((call) => call.method === method)).toHaveLength(1);
      expect(
        calls.every((call) =>
          ["getLatestLedger", "getLedgerEntries", "simulateTransaction"].includes(call.method),
        ),
      ).toBe(true);
    },
  );

  it("uses one deadline for eligibility, ledger, account, simulation and final eligibility", async () => {
    const budgets: unknown[] = [];
    const remaining: number[] = [];
    const observe = () => {
      budgets.push(interactiveRpcBudget());
      remaining.push(remainingInteractiveRpcMs());
      vi.setSystemTime(Date.now() + 4_000);
    };
    mocks.latest.mockImplementation(async () => observe());
    mocks.state.mockImplementation(async () => {
      observe();
      return state;
    });
    rpcFetch(async (call) => {
      observe();
      return normal(call);
    });
    await expect(prepare()).resolves.toMatchObject({ action: "subscription.reactivate" });
    expect(remaining).toEqual([25_000, 21_000, 17_000, 13_000, 9_000]);
    expect(budgets.every((budget) => budget === budgets[0] && budget !== undefined)).toBe(true);
    expect(mocks.createIntent).toHaveBeenCalledOnce();
    expect(sorobanRpc().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
    expect(STELLAR_HTTP_TIMEOUT_MS).toBe(10_000);
  });

  it("does not reserve an intent after final eligibility consumes the remaining budget", async () => {
    mocks.state
      .mockImplementationOnce(async () => state)
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 25_000);
        return state;
      });
    await expect(prepare()).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
    unchanged();
  });

  it("does not give nested preparation another 25 seconds", async () => {
    rpcFetch(async (call, init) =>
      call.method === "simulateTransaction" ? stalled(init) : normal(call),
    );
    const result = withInteractiveRpcBudget(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      return prepare();
    });
    const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    unchanged();
  });

  it("preserves a genuine contract simulation failure and its diagnostic details", async () => {
    rpcFetch(async (call) =>
      call.method === "simulateTransaction"
        ? { latestLedger: 1000, error: "Error(Contract, #5)" }
        : normal(call),
    );
    const error = await prepare().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SimulationError);
    expect(error).toMatchObject({
      code: "UPSTREAM_RPC",
      details: expect.stringContaining("Error(Contract, #5)"),
    });
    expect(String(error)).not.toContain("could not simulate this subscription control");
    unchanged();
  });

  it.each(["FORBIDDEN", "CONFLICT", "VALIDATION"] as const)(
    "preserves %s eligibility refusals",
    async (code) => {
      const error = new AppError(code, "Existing refusal");
      mocks.state.mockRejectedValueOnce(error);
      await expect(prepare()).rejects.toBe(error);
      unchanged();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["initial", "getLedgerEntries", 1],
    ["initial", "simulateTransaction", 1],
    ["post-simulation", "getLedgerEntries", 2],
    ["post-simulation", "simulateTransaction", 2],
  ] as const)(
    "classifies %s eligibility %s timeouts without a false unfunded-account refusal",
    async (_stage, method, stateRead) => {
      // Exercise the real state resolver and its opt-in relayer readers, not builder mocks.
      const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
        "@/lib/subscription/state",
      );
      sorobanRpc(); // Initialize without relayer startup work before enabling the read source.
      mocks.relayerAddress.mockReturnValue(wallet);
      mocks.state.mockImplementation(real.readSubscriptionState);
      rpcFetch(async (call, init) => {
        if (call.method === method && mocks.state.mock.calls.length === stateRead)
          return stalled(init);
        if (call.method !== "simulateTransaction") return normal(call);
        const tx = TransactionBuilder.fromXDR(
          (call.params as { transaction: string }).transaction,
          Networks.TESTNET,
        );
        if (!(tx instanceof Transaction)) throw new Error("Unexpected fee-bump transaction");
        const operation = tx.operations[0]!;
        if (operation.type !== "invokeHostFunction")
          throw new Error("Unexpected transaction operation");
        const fn = operation.func.invokeContract().functionName().toString();
        const retval =
          fn === "subscriber"
            ? new Address(wallet).toScVal()
            : fn === "asset"
              ? new Address(asset).toScVal()
              : fn === "is_cancelled"
                ? xdr.ScVal.scvBool(true)
                : xdr.ScVal.scvVoid();
        return { ...success(), results: [{ auth: [], xdr: retval.toXDR("base64") }] };
      });
      const result = prepare();
      const rejected = expect(result).rejects.toMatchObject({ code: "UPSTREAM_RPC", status: 502 });
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      expect(mocks.state).toHaveBeenCalledTimes(stateRead);
      expect(mocks.state).toHaveBeenCalledWith(deployment.id, {
        snapshotOnly: true,
        classifyRpcFailures: true,
      });
      unchanged();
    },
  );

  it("preserves genuinely absent eligibility read-source classification", async () => {
    const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
      "@/lib/subscription/state",
    );
    sorobanRpc();
    mocks.relayerAddress.mockReturnValue(wallet);
    mocks.state.mockImplementation(real.readSubscriptionState);
    rpcFetch(async () => ({ latestLedger: 1000, entries: [] }));
    await expect(prepare()).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 402 });
    unchanged();
  });

  it.each([
    ["subscriber", xdr.ScVal.scvVoid(), "VALIDATION"],
    ["subscriber", xdr.ScVal.scvU32(1), "UPSTREAM_RPC"],
    ["subscriber", xdr.ScVal.scvString("invalid-address"), "UPSTREAM_RPC"],
    ["asset", new Address(wallet).toScVal(), "UPSTREAM_RPC"],
    ["is_cancelled", xdr.ScVal.scvString("true"), "UPSTREAM_RPC"],
  ] as const)(
    "validates opt-in %s getter results without reserving an intent",
    async (getter, invalidValue, code) => {
      const real = await vi.importActual<typeof import("@/lib/subscription/state")>(
        "@/lib/subscription/state",
      );
      sorobanRpc();
      mocks.relayerAddress.mockReturnValue(wallet);
      mocks.state.mockImplementation(real.readSubscriptionState);
      rpcFetch(async (call) => {
        if (call.method !== "simulateTransaction") return normal(call);
        const tx = TransactionBuilder.fromXDR(
          (call.params as { transaction: string }).transaction,
          Networks.TESTNET,
        );
        if (!(tx instanceof Transaction)) throw new Error("Unexpected fee-bump transaction");
        const operation = tx.operations[0]!;
        if (operation.type !== "invokeHostFunction")
          throw new Error("Unexpected transaction operation");
        const fn = operation.func.invokeContract().functionName().toString();
        const retval =
          fn === getter
            ? invalidValue
            : fn === "subscriber"
              ? new Address(wallet).toScVal()
              : fn === "asset"
                ? new Address(asset).toScVal()
                : xdr.ScVal.scvBool(true);
        return { ...success(), results: [{ auth: [], xdr: retval.toXDR("base64") }] };
      });
      await expect(prepare()).rejects.toMatchObject({ code });
      unchanged();
    },
  );

  it("does not misclassify a durable intent storage error as an RPC failure", async () => {
    const error = new Error("intent storage failed");
    mocks.createIntent.mockRejectedValueOnce(error);
    await expect(prepare()).rejects.toBe(error);
    expect(mocks.createIntent).toHaveBeenCalledOnce();
  });

  it.each([
    ["cancel", ownerCancel],
    ["reactivate", ownerReactivate],
  ] as const)(
    "gives the participant %s preparation the same aggregate RPC budget",
    async (_name, handler) => {
      const budgets: unknown[] = [];
      rpcFetch(async (call) => {
        budgets.push(interactiveRpcBudget());
        expect(remainingInteractiveRpcMs()).toBe(budgets.length === 1 ? 25_000 : 9_000);
        if (budgets.length === 1) vi.setSystemTime(Date.now() + 16_000);
        return normal(call);
      });
      const response = await handler(
        new Request("https://paiflow.test/subscription-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userAddress: wallet }),
        }) as NextRequest,
        { params: Promise.resolve({ id: deployment.id }) },
      );
      expect(response.status).toBe(200);
      expect(budgets).toHaveLength(2);
      expect(budgets[0]).toBeDefined();
      expect(budgets[1]).toBe(budgets[0]);
      expect(sorobanRpc().httpClient.defaults.timeout).toBe(10_000);
    },
  );
});
